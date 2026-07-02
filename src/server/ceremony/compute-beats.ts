import { and, desc, eq, gte, inArray, isNotNull, lt, ne, sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  db,
  declaredInterests,
  feedItems,
  joshingGameResponses,
  knowledgeNodes,
  knowledgeParentMastery,
  masteryEvents,
  playerMastery,
  profileDomainVisibility,
  questions,
  users,
} from '@/server/db';
import { getFriends } from '@/server/db/queries/friends';
import {
  buildClusterMatcher,
  getClusterContext,
  isKnowledgeGraphCeremonyEnabled,
} from '@/server/knowledge/graph';
import { ceremonyModeFromAnsweringCount, type CeremonyMode } from '@/lib/ceremony/mode';
import { djb2 } from '@/lib/lately';
import type { MasteryTier } from '@/types/db';

// F3.5: runtime validation of the beats payload. Strict at write time
// (catches bugs in compute-beats early); lenient at read time (don't break
// the pre-existing corpus that may not match this schema exactly — see the
// ceremony GET route).
const masteryTierSchema = z.enum(['establishing', 'familiar', 'solid', 'mastery']);

const beat1Schema = z.array(
  z.object({
    domain: z.string(),
    fromTier: masteryTierSchema,
    toTier: masteryTierSchema,
    // B-KNOWLEDGE-TAXONOMY-01 P6: which grain the promotion fired at. Additive
    // (.optional()) — pre-graph payloads (and flag-off writes) carry no grain
    // and still validate.
    grain: z.enum(['leaf', 'parent']).optional(),
  }),
);

const beat2Schema = z.object({
  friendMediated: z.array(
    z.object({
      domain: z.string(),
      questionCount: z.number(),
      correctCount: z.number(),
      // The friend whose question(s) most opened this domain for the user.
      // Additive (.optional()) so payloads written before the redesign — which
      // had no friend attribution — still validate on read.
      via: z.string().nullable().optional(),
    }),
  ),
  authored: z.array(z.object({ domain: z.string() })),
  promoted: z.array(z.object({ domain: z.string() })),
});

const beat3Schema = z.array(
  z.object({
    userId: z.string(),
    displayName: z.string(),
    contributionCount: z.number(),
  }),
);

const beat4Schema = z.object({
  userId: z.string(),
  displayName: z.string(),
  sharedDomains: z.array(z.string()),
});

const beat5Schema = z.object({
  totalCreatorPoints: z.number(),
  // Total times the user's questions were answered by friends this cycle (one
  // per author-credit event). Additive (.optional()) for read-lenience on the
  // pre-redesign corpus.
  totalAnswered: z.number().optional(),
  topQuestion: z
    .object({ text: z.string(), answeredCount: z.number() })
    .nullable(),
});

// Opener stats for the ceremony's first room. Additive + nullable().optional()
// so the pre-redesign corpus (no opener) still validates on read.
const openerSchema = z.object({
  weekIndex: z.number(),
  questionsRight: z.number(),
  sessionsPlayed: z.number(),
});

// Friend-fallback shapes: when a user has zero activity for Beat1/Beat5 in the
// 7-day window, we surface the friend who did the most in that area instead.
// Only computed when the primary beat is null; rendered as a distinct beat
// view ("Your friends were busy"-style) rather than masquerading as the user's.
const beat1FallbackSchema = z.object({
  friendName: z.string(),
  count: z.number(),
  domains: z.array(z.string()),
});

const beat5FallbackSchema = z.object({
  friendName: z.string(),
  totalCreatorPoints: z.number(),
});

// Beat 6 (Learned): questions the user missed earlier and got right this cycle.
// Additive beat — declared nullable().optional() so the pre-existing corpus
// (payloads written before this beat existed) still validates on read.
const beat6Schema = z.array(
  z.object({
    domain: z.string(),
    questionText: z.string(),
    correctAnswer: z.string(),
  }),
);

export const beatsPayloadSchema = z.object({
  cycleStart: z.string(),
  cycleEnd: z.string(),
  opener: openerSchema.nullable().optional(),
  mode: z.enum(['solo', 'duo', 'group']).optional(),
  mergeNote: z
    .object({
      mergesApplied: z.number(),
      details: z.array(
        z.object({
          sources: z.array(z.string()),
          target: z.string(),
          rationale: z.string(),
        }),
      ),
    })
    .optional(),
  beat1: beat1Schema.nullable(),
  beat1FriendFallback: beat1FallbackSchema.nullable().optional(),
  beat2: beat2Schema.nullable(),
  beat3: beat3Schema.nullable(),
  beat4: beat4Schema.nullable(),
  beat5: beat5Schema.nullable(),
  beat5FriendFallback: beat5FallbackSchema.nullable().optional(),
  beat6: beat6Schema.nullable().optional(),
});

export type Beat1Mastered = {
  domain: string;
  fromTier: MasteryTier;
  toTier: MasteryTier;
  // P6: leaf vs parent promotion, labeled distinctly (§D). Absent on flag-off
  // writes and the pre-graph corpus.
  grain?: 'leaf' | 'parent';
}[];
export type Beat2DiscoveredItem = {
  domain: string;
  questionCount: number;
  correctCount: number;
  via?: string | null;
};
export type Beat2Discovered = {
  friendMediated: Beat2DiscoveredItem[];
  authored: { domain: string }[];
  promoted: { domain: string }[];
};
export type Beat3Shaped = { userId: string; displayName: string; contributionCount: number }[];
export type Beat4Alignment = { userId: string; displayName: string; sharedDomains: string[] };
export type Beat5Gave = {
  totalCreatorPoints: number;
  totalAnswered?: number;
  topQuestion: { text: string; answeredCount: number } | null;
};
export type CeremonyOpener = {
  weekIndex: number;
  questionsRight: number;
  sessionsPlayed: number;
};

export type Beat1FriendFallback = { friendName: string; count: number; domains: string[] };
export type Beat5FriendFallback = { friendName: string; totalCreatorPoints: number };
export type Beat6LearnedItem = { domain: string; questionText: string; correctAnswer: string };
export type Beat6Learned = Beat6LearnedItem[];

export type BeatsPayload = {
  cycleStart: string;
  cycleEnd: string;
  /** Stats for the ceremony opener room (week number, correct answers, days
   * played in the cycle). Optional so the pre-redesign corpus stays valid. */
  opener?: CeremonyOpener | null;
  /**
   * F3.2: classifies the ceremony as solo / duo / group based on the count
   * of friends who actively answered in the cycle. Drives copy variants and
   * future beat suppression (e.g. Beat 3 / Beat 4 don't make sense in solo
   * mode). Stored on the payload (not as a separate column) to avoid a
   * schema migration; downstream UI / telemetry can read it directly.
   */
  mode?: CeremonyMode;
  mergeNote?: {
    mergesApplied: number;
    details: Array<{ sources: string[]; target: string; rationale: string }>;
  };
  beat1: Beat1Mastered | null;
  beat1FriendFallback?: Beat1FriendFallback | null;
  beat2: Beat2Discovered | null;
  beat3: Beat3Shaped | null;
  beat4: Beat4Alignment | null;
  beat5: Beat5Gave | null;
  beat5FriendFallback?: Beat5FriendFallback | null;
  beat6?: Beat6Learned | null;
};

const TIER_ORDER: MasteryTier[] = ['establishing', 'familiar', 'solid', 'mastery'];

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function endExclusive(cycleEnd: Date): Date {
  const end = new Date(cycleEnd);
  end.setUTCDate(end.getUTCDate() + 1);
  end.setUTCHours(0, 0, 0, 0);
  return end;
}

function domainFor(question: Pick<typeof questions.$inferSelect, 'canonicalSubcategory' | 'broadCategory' | 'category'>): string | null {
  return question.canonicalSubcategory || question.broadCategory || question.category || null;
}

function previousTier(tier: MasteryTier): MasteryTier {
  const index = TIER_ORDER.indexOf(tier);
  return TIER_ORDER[Math.max(0, index - 1)] ?? 'establishing';
}

async function computeBeat1(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat1Mastered | null> {
  const rows = await db
    .select({
      domain: playerMastery.canonicalSubcategory,
      toTier: playerMastery.tier,
    })
    .from(playerMastery)
    .where(and(
      eq(playerMastery.userId, userId),
      isNotNull(playerMastery.tierReachedAt),
      gte(playerMastery.tierReachedAt, cycleStart),
      lt(playerMastery.tierReachedAt, cycleEndExclusive),
    ))
    .orderBy(desc(playerMastery.tierReachedAt));

  // B-KNOWLEDGE-TAXONOMY-01 P6 (§D: Beat 1 fires BOTH grains, labeled
  // distinctly). Flag-off = today's exact output — no grain fields, no parent
  // query. Flag-on: leaf rows carry grain 'leaf'; parent crossings come from
  // the P4 freeze ledger (the crossing moment IS the promotion event).
  if (!isKnowledgeGraphCeremonyEnabled()) {
    if (rows.length === 0) return null;
    return rows.map((row) => ({
      domain: row.domain,
      fromTier: previousTier(row.toTier),
      toTier: row.toTier,
    }));
  }

  const parentRows = await db
    .select({ label: knowledgeNodes.label })
    .from(knowledgeParentMastery)
    .innerJoin(knowledgeNodes, eq(knowledgeNodes.domainKey, knowledgeParentMastery.parentDomainKey))
    .where(and(
      eq(knowledgeParentMastery.userId, userId),
      gte(knowledgeParentMastery.masteredAt, cycleStart),
      lt(knowledgeParentMastery.masteredAt, cycleEndExclusive),
    ))
    .orderBy(desc(knowledgeParentMastery.masteredAt));

  const items: Beat1Mastered = [
    ...rows.map((row) => ({
      domain: row.domain,
      fromTier: previousTier(row.toTier),
      toTier: row.toTier,
      grain: 'leaf' as const,
    })),
    ...parentRows.map((row) => ({
      domain: row.label,
      fromTier: previousTier('mastery'),
      toTier: 'mastery' as const,
      grain: 'parent' as const,
    })),
  ];
  return items.length > 0 ? items : null;
}

async function readCorrectQuestionIds(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Set<string>> {
  const rows = await db
    .select({ questionId: masteryEvents.questionId })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.answeredByUserId, userId),
      eq(masteryEvents.sourceType, 'live_correct'),
      isNotNull(masteryEvents.questionId),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
      sql`${masteryEvents.awardedPoints} > 0`,
    ));

  return new Set(rows.map((row) => row.questionId).filter((id): id is string => Boolean(id)));
}

async function computeBeat2(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat2Discovered | null> {
  const interests = await db
    .select({ domain: declaredInterests.domain })
    .from(declaredInterests)
    .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)));
  const declaredDomains = new Set(interests.map((interest) => interest.domain));

  const [gameAnswers, feedAnswers, correctQuestionIds, authoredDeclared, promotedRows] = await Promise.all([
    db
      .select({ question: questions, isCorrect: joshingGameResponses.isCorrect })
      .from(joshingGameResponses)
      .innerJoin(questions, eq(joshingGameResponses.questionId, questions.id))
      .where(and(
        eq(joshingGameResponses.userId, userId),
        gte(joshingGameResponses.answeredAt, cycleStart),
        lt(joshingGameResponses.answeredAt, cycleEndExclusive),
      )),
    db
      .select({ question: questions, sourceUserId: feedItems.sourceUserId })
      .from(feedItems)
      .innerJoin(questions, eq(feedItems.questionId, questions.id))
      .where(and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.state, 'answered'),
        gte(feedItems.sourceEventAt, cycleStart),
        lt(feedItems.sourceEventAt, cycleEndExclusive),
      )),
    readCorrectQuestionIds(userId, cycleStart, cycleEndExclusive),
    db
      .select({ domain: playerMastery.canonicalSubcategory })
      .from(playerMastery)
      .where(and(
        eq(playerMastery.userId, userId),
        eq(playerMastery.territoryType, 'declared'),
        gte(playerMastery.updatedAt, cycleStart),
        lt(playerMastery.updatedAt, cycleEndExclusive),
      )),
    db
      .select({ domain: masteryEvents.canonicalSubcategory })
      .from(masteryEvents)
      .where(and(
        eq(masteryEvents.userId, userId),
        eq(masteryEvents.sourceType, 'declared_promoted'),
        gte(masteryEvents.createdAt, cycleStart),
        lt(masteryEvents.createdAt, cycleEndExclusive),
      )),
  ]);

  const byDomain = new Map<string, { domain: string; questionCount: number; correctCount: number }>();
  // domain → (contributorId → count): the friend whose question(s) opened each
  // domain. Self-authored questions don't count as a "via" (you didn't discover
  // it from a friend), so the user's own id is skipped.
  const contributorsByDomain = new Map<string, Map<string, number>>();
  const add = (domain: string, correct: boolean, contributorId: string | null) => {
    if (declaredDomains.has(domain)) return;
    const current = byDomain.get(domain) ?? { domain, questionCount: 0, correctCount: 0 };
    current.questionCount += 1;
    if (correct) current.correctCount += 1;
    byDomain.set(domain, current);
    if (contributorId && contributorId !== userId) {
      const counts = contributorsByDomain.get(domain) ?? new Map<string, number>();
      counts.set(contributorId, (counts.get(contributorId) ?? 0) + 1);
      contributorsByDomain.set(domain, counts);
    }
  };

  gameAnswers.forEach((row) => {
    const domain = domainFor(row.question);
    if (domain) add(domain, row.isCorrect === true, row.question.creatorId);
  });
  feedAnswers.forEach((row) => {
    const domain = domainFor(row.question);
    if (domain) add(domain, correctQuestionIds.has(row.question.id), row.sourceUserId);
  });

  // Resolve the top contributor per domain to a display name in one batch query.
  const topContributorByDomain = new Map<string, string>();
  for (const [domain, counts] of contributorsByDomain) {
    const [top] = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (top) topContributorByDomain.set(domain, top[0]);
  }
  const viaIds = [...new Set(topContributorByDomain.values())];
  const viaNameById = new Map<string, string>();
  if (viaIds.length > 0) {
    const viaRows = await db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, viaIds));
    viaRows.forEach((row) => viaNameById.set(row.id, row.displayName?.trim() || 'A friend'));
  }

  const friendMediated = [...byDomain.values()]
    .sort((a, b) => b.questionCount - a.questionCount || a.domain.localeCompare(b.domain))
    .map((item) => {
      const viaId = topContributorByDomain.get(item.domain);
      return { ...item, via: viaId ? (viaNameById.get(viaId) ?? null) : null };
    });

  const seenAuthored = new Set<string>();
  const authored = authoredDeclared
    .map((row) => ({ domain: row.domain }))
    .filter((row) => { if (seenAuthored.has(row.domain)) return false; seenAuthored.add(row.domain); return true; });

  const seenPromoted = new Set<string>();
  const promoted = promotedRows
    .map((row) => ({ domain: row.domain }))
    .filter((row) => { if (seenPromoted.has(row.domain)) return false; seenPromoted.add(row.domain); return true; });

  if (friendMediated.length === 0 && authored.length === 0 && promoted.length === 0) return null;
  return { friendMediated, authored, promoted };
}

async function computeBeat3(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat3Shaped | null> {
  const [gameRows, feedRows, correctQuestionIds] = await Promise.all([
    db
      .select({ contributorId: questions.creatorId, questionId: questions.id })
      .from(joshingGameResponses)
      .innerJoin(questions, eq(joshingGameResponses.questionId, questions.id))
      .where(and(
        eq(joshingGameResponses.userId, userId),
        eq(joshingGameResponses.isCorrect, true),
        gte(joshingGameResponses.answeredAt, cycleStart),
        lt(joshingGameResponses.answeredAt, cycleEndExclusive),
        ne(questions.creatorId, userId),
      )),
    db
      .select({ contributorId: feedItems.sourceUserId, questionId: feedItems.questionId })
      .from(feedItems)
      .where(and(
        eq(feedItems.recipientUserId, userId),
        eq(feedItems.state, 'answered'),
        ne(feedItems.sourceUserId, userId),
        gte(feedItems.sourceEventAt, cycleStart),
        lt(feedItems.sourceEventAt, cycleEndExclusive),
      )),
    readCorrectQuestionIds(userId, cycleStart, cycleEndExclusive),
  ]);

  const counts = new Map<string, number>();
  gameRows.forEach((row) => {
    if (row.contributorId) counts.set(row.contributorId, (counts.get(row.contributorId) ?? 0) + 1);
  });
  feedRows.forEach((row) => {
    if (row.contributorId && row.questionId && correctQuestionIds.has(row.questionId)) {
      counts.set(row.contributorId, (counts.get(row.contributorId) ?? 0) + 1);
    }
  });

  const topIds = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id]) => id);
  if (topIds.length === 0) return null;

  const userRows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, topIds));
  const nameById = new Map(userRows.map((user) => [user.id, user.displayName?.trim() || 'Someone']));

  return topIds.map((id) => ({
    userId: id,
    displayName: nameById.get(id) ?? 'Someone',
    contributionCount: counts.get(id) ?? 0,
  }));
}

async function computeBeat4(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat4Alignment | null> {
  const friends = await getFriends(userId);
  const friendIds = new Set(friends.map((friend) => friend.id));
  if (friendIds.size === 0) return null;

  // Only consider friends who answered at least one question in this cycle;
  // all-time mastery overlap could surface a friend who hasn't played in months.
  const activeFriendRows = await db
    .selectDistinct({ userId: masteryEvents.userId })
    .from(masteryEvents)
    .where(and(
      inArray(masteryEvents.userId, [...friendIds]),
      inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ));
  const activeFriendIds = new Set(activeFriendRows.map((r) => r.userId));
  if (activeFriendIds.size === 0) return null;

  // F3.4: LEFT JOIN profileDomainVisibility so we can filter friend rows
  // marked private. Viewer's own rows always pass through (their portrait,
  // their data); only the FRIEND's privacy setting hides a friend's domain
  // from this viewer's alignment beat. Missing visibility row defaults to
  // 'public' (per the table default), which is included.
  const rows = await db
    .select({
      userId: playerMastery.userId,
      displayName: users.displayName,
      domain: playerMastery.canonicalSubcategory,
      visibility: profileDomainVisibility.visibility,
    })
    .from(playerMastery)
    .innerJoin(users, eq(playerMastery.userId, users.id))
    .leftJoin(
      profileDomainVisibility,
      and(
        eq(profileDomainVisibility.userId, playerMastery.userId),
        eq(profileDomainVisibility.canonicalSubcategory, playerMastery.canonicalSubcategory),
      ),
    )
    .where(sql`${playerMastery.totalPoints} > 0`);

  const viewerDomainList = rows.filter((row) => row.userId === userId).map((row) => row.domain);
  if (viewerDomainList.length === 0) return null;

  // B-KNOWLEDGE-TAXONOMY-01 P6 (§D — the original complaint): flag-on, overlap
  // is computed at CLUSTER grain — two different strings align when their
  // clusters (folded key + substantive ancestors in the authored graph)
  // intersect, and the shared territory shows under the authored node's label.
  // Flag-off = today's exact-string behavior, byte-identical.
  let sharedLabelFor: (friendDomain: string) => string | null;
  if (isKnowledgeGraphCeremonyEnabled()) {
    const ctx = await getClusterContext();
    sharedLabelFor = buildClusterMatcher(viewerDomainList, ctx);
  } else {
    const viewerDomains = new Set(viewerDomainList);
    sharedLabelFor = (domain) => (viewerDomains.has(domain) ? domain : null);
  }

  const candidates = new Map<string, { displayName: string; sharedDomains: string[] }>();
  rows.forEach((row) => {
    if (row.userId === userId || !activeFriendIds.has(row.userId)) return;
    // A friend marked this domain private — do not surface it to anyone
    // else's ceremony, even if both share points there. (Checked BEFORE any
    // cluster resolution — privacy outranks alignment.)
    if (row.visibility === 'private') return;
    const shared = sharedLabelFor(row.domain);
    if (shared === null) return;
    const current = candidates.get(row.userId) ?? { displayName: row.displayName?.trim() || 'Someone', sharedDomains: [] };
    // Cluster mode can resolve two friend strings to one territory — dedupe.
    if (!current.sharedDomains.includes(shared)) current.sharedDomains.push(shared);
    candidates.set(row.userId, current);
  });

  const [best] = [...candidates.entries()].sort((a, b) => b[1].sharedDomains.length - a[1].sharedDomains.length);
  if (!best || best[1].sharedDomains.length === 0) return null;
  return { userId: best[0], displayName: best[1].displayName, sharedDomains: best[1].sharedDomains.sort() };
}

async function computeBeat5(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat5Gave | null> {
  const rows = await db
    .select({
      questionId: masteryEvents.questionId,
      awardedPoints: masteryEvents.awardedPoints,
      questionText: questions.questionText,
    })
    .from(masteryEvents)
    .leftJoin(questions, eq(masteryEvents.questionId, questions.id))
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.sourceType, 'author_credit'),
      ne(masteryEvents.answeredByUserId, userId),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ));

  if (rows.length === 0) return null;
  const totalCreatorPoints = Math.round(rows.reduce((sum, row) => sum + Number(row.awardedPoints ?? 0), 0) * 10) / 10;
  // One author_credit row == one friend answering one of your questions, so the
  // row count is the total times your questions were answered this cycle.
  const totalAnswered = rows.length;
  const byQuestion = new Map<string, { text: string; answeredCount: number }>();
  rows.forEach((row) => {
    if (!row.questionId || !row.questionText) return;
    const current = byQuestion.get(row.questionId) ?? { text: row.questionText, answeredCount: 0 };
    current.answeredCount += 1;
    byQuestion.set(row.questionId, current);
  });
  const [topQuestion] = [...byQuestion.values()].sort((a, b) => b.answeredCount - a.answeredCount);
  return { totalCreatorPoints, totalAnswered, topQuestion: topQuestion ?? null };
}

/**
 * Friend fallback for Beat1 (Mastered). When the user themselves had no tier
 * progressions in the cycle, surface the friend who progressed the most so
 * the ceremony doesn't open on a blank screen. Returns null when no friend
 * has any progressions either. Respects per-domain privacy: a friend's
 * domain marked private is excluded from the count and the listed domains.
 */
async function computeBeat1FriendFallback(
  userId: string,
  cycleStart: Date,
  cycleEndExclusive: Date,
): Promise<Beat1FriendFallback | null> {
  const friends = await getFriends(userId);
  if (friends.length === 0) return null;
  const friendIds = friends.map((friend) => friend.id);

  const rows = await db
    .select({
      friendId: playerMastery.userId,
      friendName: users.displayName,
      domain: playerMastery.canonicalSubcategory,
      visibility: profileDomainVisibility.visibility,
    })
    .from(playerMastery)
    .innerJoin(users, eq(playerMastery.userId, users.id))
    .leftJoin(
      profileDomainVisibility,
      and(
        eq(profileDomainVisibility.userId, playerMastery.userId),
        eq(profileDomainVisibility.canonicalSubcategory, playerMastery.canonicalSubcategory),
      ),
    )
    .where(and(
      inArray(playerMastery.userId, friendIds),
      isNotNull(playerMastery.tierReachedAt),
      gte(playerMastery.tierReachedAt, cycleStart),
      lt(playerMastery.tierReachedAt, cycleEndExclusive),
    ));

  const byFriend = new Map<string, { friendName: string; domains: string[] }>();
  rows.forEach((row) => {
    if (row.visibility === 'private') return;
    const entry = byFriend.get(row.friendId) ?? {
      friendName: row.friendName?.trim() || 'A friend',
      domains: [],
    };
    entry.domains.push(row.domain);
    byFriend.set(row.friendId, entry);
  });

  const [top] = [...byFriend.values()].sort((a, b) => b.domains.length - a.domains.length);
  if (!top || top.domains.length === 0) return null;
  return { friendName: top.friendName, count: top.domains.length, domains: top.domains.sort() };
}

/**
 * Friend fallback for Beat5 (Gave). When the user themselves earned no author
 * credit in the cycle, surface the friend whose questions earned the most.
 * Aggregate only — no domain or question text — so no per-domain privacy
 * filtering is needed.
 */
async function computeBeat5FriendFallback(
  userId: string,
  cycleStart: Date,
  cycleEndExclusive: Date,
): Promise<Beat5FriendFallback | null> {
  const friends = await getFriends(userId);
  if (friends.length === 0) return null;
  const friendIds = friends.map((friend) => friend.id);

  const rows = await db
    .select({
      friendId: masteryEvents.userId,
      friendName: users.displayName,
      awardedPoints: masteryEvents.awardedPoints,
    })
    .from(masteryEvents)
    .innerJoin(users, eq(masteryEvents.userId, users.id))
    .where(and(
      inArray(masteryEvents.userId, friendIds),
      eq(masteryEvents.sourceType, 'author_credit'),
      ne(masteryEvents.answeredByUserId, masteryEvents.userId),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ));

  const byFriend = new Map<string, { friendName: string; total: number }>();
  rows.forEach((row) => {
    const entry = byFriend.get(row.friendId) ?? {
      friendName: row.friendName?.trim() || 'A friend',
      total: 0,
    };
    entry.total += Number(row.awardedPoints ?? 0);
    byFriend.set(row.friendId, entry);
  });

  const [top] = [...byFriend.values()].sort((a, b) => b.total - a.total);
  if (!top || top.total <= 0) return null;
  return {
    friendName: top.friendName,
    totalCreatorPoints: Math.round(top.total * 10) / 10,
  };
}

// Curate the discovery beat (Beat E) to a tight, breathing set — the copy doc
// says 2–3, never a dump.
const BEAT_E_MAX_ITEMS = 3;

export type DiscoveryCandidate = {
  questionId: string;
  domain: string;
  questionText: string;
  correctAnswer: string;
  createdAt: Date;
};

/**
 * Pure selection signal for Beat E (the blocker), resolved per
 * REFLECTION-AUDIT-01 Q5 + D-REFLECTION-COPY-01 §3 preference order:
 *   1. "most friends also missed it" (friendMissCount) — most relational, best
 *      fits the "my people and I" thesis.
 *   2. most-recent (createdAt) — tiebreak.
 *   3. hash-stable (djb2 of questionId) — deterministic final tiebreak so a
 *      given week always curates the same cards.
 * Extracted as a pure function so the ranking is unit-testable without the DB.
 */
export function selectDiscoveries(
  candidates: DiscoveryCandidate[],
  friendMissCount: Map<string, number>,
  max: number,
): Beat6Learned {
  return [...candidates]
    .sort((a, b) => {
      const byFriends =
        (friendMissCount.get(b.questionId) ?? 0) - (friendMissCount.get(a.questionId) ?? 0);
      if (byFriends !== 0) return byFriends;
      const byRecency = b.createdAt.getTime() - a.createdAt.getTime();
      if (byRecency !== 0) return byRecency;
      return djb2(a.questionId) - djb2(b.questionId);
    })
    .slice(0, max)
    .map((candidate) => ({
      domain: candidate.domain,
      questionText: candidate.questionText,
      correctAnswer: candidate.correctAnswer,
    }));
}

/**
 * Beat E (Discovered) — questions the user got WRONG this cycle. A wrong or
 * expired answer is recorded as answer_state = 'incorrect' (schema
 * answerStateEnum has no separate 'expired'); a miss is a *discovery*, never a
 * failure, and this is the emotional peak of the weekly Reflection.
 *
 * Scope: canonical questions only (masteryEvents.questionId references the
 * questions table). Pure bot daily slots generate a per-user question with no
 * shared id, so (a) there is no canonical row to render their text from and
 * (b) the "most friends also missed it" signal is undefined for them. Those
 * pure-bot misses are simply not surfaced in the ceremony.
 *
 * Selection: selectDiscoveries() — friend-co-miss → most-recent → hash-stable.
 * The friend-co-miss query mirrors getLatelyConvergences (co-correct overlap),
 * flipped to 'incorrect'.
 *
 * NOTE: the payload field / type are still named `beat6` / Beat6Learned for
 * backward compatibility with stored ceremonies; the semantics are now Beat E
 * (discovery), not the old redemption beat.
 */
async function computeBeat6(userId: string, cycleStart: Date, cycleEndExclusive: Date): Promise<Beat6Learned | null> {
  const rows = await db
    .select({
      questionId: questions.id,
      questionText: questions.questionText,
      answerText: questions.answerText,
      canonicalSubcategory: questions.canonicalSubcategory,
      broadCategory: questions.broadCategory,
      category: questions.category,
      deletedAt: questions.deletedAt,
      createdAt: masteryEvents.createdAt,
    })
    .from(masteryEvents)
    .innerJoin(questions, eq(questions.id, masteryEvents.questionId))
    .where(and(
      eq(masteryEvents.userId, userId),
      eq(masteryEvents.answerState, 'incorrect'),
      isNotNull(masteryEvents.questionId),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ))
    .orderBy(desc(masteryEvents.createdAt));

  // One candidate per question (keep the most recent miss), drop deleted.
  const seen = new Set<string>();
  const candidates: DiscoveryCandidate[] = [];
  for (const row of rows) {
    if (row.deletedAt) continue;
    if (seen.has(row.questionId)) continue;
    seen.add(row.questionId);
    const domain = domainFor(row);
    if (!domain) continue;
    candidates.push({
      questionId: row.questionId,
      domain,
      questionText: row.questionText,
      correctAnswer: row.answerText,
      createdAt: row.createdAt,
    });
  }
  if (candidates.length === 0) return null;

  // Relational signal: how many of the user's friends also missed each of these
  // canonical questions (all-time — "this is hard for your people too"). Mirrors
  // getLatelyConvergences, flipped from correct to incorrect.
  const friendMissCount = new Map<string, number>();
  const friends = await getFriends(userId);
  const friendIds = friends.map((friend) => friend.id);
  if (friendIds.length > 0) {
    const candidateIds = candidates.map((candidate) => candidate.questionId);
    const friendRows = await db
      .selectDistinct({
        friendId: masteryEvents.userId,
        questionId: masteryEvents.questionId,
      })
      .from(masteryEvents)
      .where(and(
        inArray(masteryEvents.userId, friendIds),
        inArray(masteryEvents.questionId, candidateIds),
        eq(masteryEvents.answerState, 'incorrect'),
        isNotNull(masteryEvents.questionId),
      ));
    for (const row of friendRows) {
      if (!row.questionId) continue;
      friendMissCount.set(row.questionId, (friendMissCount.get(row.questionId) ?? 0) + 1);
    }
  }

  const selected = selectDiscoveries(candidates, friendMissCount, BEAT_E_MAX_ITEMS);
  return selected.length > 0 ? selected : null;
}

/**
 * F3.2 — count friends who answered at least one question in the cycle.
 * Plus the user themselves (always 1). Used to derive ceremony mode.
 */
async function countActiveAnsweringPlayers(
  userId: string,
  cycleStart: Date,
  cycleEndExclusive: Date,
): Promise<number> {
  const friends = await getFriends(userId);
  if (friends.length === 0) return 1;

  const friendIds = friends.map((friend) => friend.id);
  const rows = await db
    .selectDistinct({ userId: masteryEvents.userId })
    .from(masteryEvents)
    .where(and(
      inArray(masteryEvents.userId, friendIds),
      inArray(masteryEvents.sourceType, ['live_correct', 'catchup_correct']),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ));

  return rows.length + 1;
}

/**
 * Opener room stats: the user's week number (since signup), distinct questions
 * answered correctly this cycle, and distinct days played. `weekIndex` derives
 * from the account age in 7-day steps (cadence is weekly — see fire-ceremony.ts).
 */
async function computeOpener(
  userId: string,
  cycleStart: Date,
  cycleEndExclusive: Date,
  cycleEnd: Date,
): Promise<CeremonyOpener> {
  const [userRow] = await db
    .select({ createdAt: users.createdAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const [stats] = await db
    .select({
      questionsRight: sql<number>`count(distinct ${masteryEvents.questionId}) filter (where ${masteryEvents.answerState} in ('first_correct', 'first_correct_after_wrong', 'repeat_correct'))`,
      sessionsPlayed: sql<number>`count(distinct date_trunc('day', ${masteryEvents.createdAt}))`,
    })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, userId),
      gte(masteryEvents.createdAt, cycleStart),
      lt(masteryEvents.createdAt, cycleEndExclusive),
    ));

  const createdAt = userRow?.createdAt ?? cycleEnd;
  const weekIndex = Math.max(
    1,
    Math.floor((cycleEnd.getTime() - createdAt.getTime()) / (7 * 86_400_000)) + 1,
  );

  return {
    weekIndex,
    questionsRight: Number(stats?.questionsRight ?? 0),
    sessionsPlayed: Number(stats?.sessionsPlayed ?? 0),
  };
}

export async function computeBeats(userId: string, cycleStart: Date, cycleEnd: Date): Promise<BeatsPayload> {
  const cycleEndExclusive = endExclusive(cycleEnd);
  const [opener, beat1, beat2, beat3, beat4, beat5, beat6, activeAnsweringPlayers] = await Promise.all([
    computeOpener(userId, cycleStart, cycleEndExclusive, cycleEnd),
    computeBeat1(userId, cycleStart, cycleEndExclusive),
    computeBeat2(userId, cycleStart, cycleEndExclusive),
    computeBeat3(userId, cycleStart, cycleEndExclusive),
    computeBeat4(userId, cycleStart, cycleEndExclusive),
    computeBeat5(userId, cycleStart, cycleEndExclusive),
    computeBeat6(userId, cycleStart, cycleEndExclusive),
    countActiveAnsweringPlayers(userId, cycleStart, cycleEndExclusive),
  ]);

  // Friend fallbacks only when the user themselves had nothing for that beat
  // in the cycle; avoids the extra queries (and the awkward "your friend did X
  // and so did you" double-render) when the primary beat is present.
  const [beat1FriendFallback, beat5FriendFallback] = await Promise.all([
    beat1 ? Promise.resolve(null) : computeBeat1FriendFallback(userId, cycleStart, cycleEndExclusive),
    beat5 ? Promise.resolve(null) : computeBeat5FriendFallback(userId, cycleStart, cycleEndExclusive),
  ]);

  const mode = ceremonyModeFromAnsweringCount(activeAnsweringPlayers);
  // Beat 3 (Shaped) and Beat 4 (Alignment) require at least one active friend;
  // suppress both in solo mode so the ceremony doesn't reference absent friends.
  const beat3Final = mode === 'solo' ? null : beat3;
  const beat4Final = mode === 'solo' ? null : beat4;

  return {
    cycleStart: toIsoDate(cycleStart),
    cycleEnd: toIsoDate(cycleEnd),
    opener,
    mode,
    beat1,
    beat1FriendFallback,
    beat2,
    beat3: beat3Final,
    beat4: beat4Final,
    beat5,
    beat5FriendFallback,
    beat6,
  };
}
