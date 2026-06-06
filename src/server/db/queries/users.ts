import type { InferSelectModel } from 'drizzle-orm';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { cache } from 'react';

import { db, declaredInterests, friendInvitations, playerMastery, users } from '@/server/db';
import {
  assertAnswerableInterest,
  categorizeInterestDomain,
  isCatchAllBroadCategory,
} from '@/server/llm/interests';
import { foldDomainPunctuation } from '@/lib/knowledge/domain-key';
import { assertSpecificInterest } from '@/lib/knowledge/interest-specificity';

type User = InferSelectModel<typeof users>;

export type DeclaredInterestInput = {
  label: string;
  description?: string | null;
  broadCategory?: string | null;
};

export type PreSeededInterest = {
  label: string;
  description?: string | null;
  broadCategory?: string | null;
};

export type PreSeededInterestsForUser = {
  interests: PreSeededInterest[];
  inviterName: string | null;
  inviteeDisplayName: string | null;
};

function normalizeDeclaredInterest(interest: DeclaredInterestInput): DeclaredInterestInput | null {
  // Fold curly apostrophes to ASCII so the stored declared interest and its
  // seeded PlayerMastery row match the straight-apostrophe canonical
  // subcategory the question pipeline emits. Without this, a label like
  // "90's ballywood" (curly, from iOS auto-correct) and the questions answered
  // against it split into two territories whose points never merge.
  const label = foldDomainPunctuation(interest.label).trim().replace(/\s+/g, ' ');
  if (!label) return null;

  return {
    label: label.slice(0, 80),
    description: interest.description?.trim() ? interest.description.trim().slice(0, 180) : null,
    broadCategory: interest.broadCategory?.trim() ? interest.broadCategory.trim().slice(0, 80) : null,
  };
}

function normalizeDeclaredInterests(interests: DeclaredInterestInput[]): DeclaredInterestInput[] {
  const seen = new Set<string>();
  const normalized: DeclaredInterestInput[] = [];

  for (const interest of interests) {
    const clean = normalizeDeclaredInterest(interest);
    if (!clean) continue;

    const key = clean.label.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(clean);
  }

  return normalized;
}

export function parsePreSeededInterests(value: unknown): PreSeededInterest[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((item) => {
    if (typeof item === 'string') {
      const label = item.trim();
      return label ? [{ label }] : [];
    }

    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const label = typeof record.label === 'string' ? record.label.trim() : '';
    if (!label) return [];

    return [{
      label,
      description: typeof record.description === 'string' ? record.description.trim() : null,
      broadCategory:
        typeof record.broadCategory === 'string'
          ? record.broadCategory.trim()
          : typeof record.broad_category === 'string'
            ? record.broad_category.trim()
            : null,
    }];
  }).slice(0, 3);
}

export async function getUserByPhone(phone: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.phoneNumber, phone),
  });
  return user ?? null;
}

export async function getUserById(id: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, id),
  });
  return user ?? null;
}

export function createUser(phone: string) {
  return db
    .insert(users)
    .values({
      phoneNumber: phone,
      phoneVerified: true,
    })
    .returning()
    .then(([user]) => user);
}

export function updateUser(id: string, data: Partial<User>) {
  return db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning()
    .then(([user]) => user);
}

// D-1 Stage 3 — gate on new followers. 'public' lets anyone follow instantly;
// 'approval_required' makes a follow a request the user approves.
export function setFollowPrivacy(id: string, followPrivacy: 'public' | 'approval_required') {
  return db
    .update(users)
    .set({ followPrivacy, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning({ id: users.id, followPrivacy: users.followPrivacy })
    .then(([row]) => row);
}

// There is no product cap on declared interests — players may declare as many as
// they like. This is a defensive *sanity* bound only: every save fans out into
// per-interest Haiku categorization (categorizeIfNeeded) and seeds a mastery row,
// so an unbounded array from a client would be a cost/DoS vector. No real user
// reaches it. (The separate "3 → 5" one-time top-up nudge lives in
// src/server/area-top-up/rules.ts and is unaffected.)
export const MAX_ACTIVE_DECLARED_INTERESTS = 100;

// Thrown when a write would push the user past the sanity bound above. Callers
// (API routes) detect this to return a 409 rather than a generic 400 so the
// client can react instead of hitting a dead end.
export class DeclaredInterestLimitError extends Error {
  constructor(
    message = `A player can declare at most ${MAX_ACTIVE_DECLARED_INTERESTS} interests.`,
  ) {
    super(message);
    this.name = 'DeclaredInterestLimitError';
  }
}

type DeclaredInterestTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Insert (or reactivate) a single declared interest and seed its zero-point
// PlayerMastery territory. Shared by the full-replace path (saveDeclaredInterests)
// and the incremental path (addDeclaredInterest) so the mastery-seeding
// invariant below lives in exactly one place — see CLAUDE.md "single chokepoint
// for every declared-interest write".
async function upsertDeclaredInterestRow(
  tx: DeclaredInterestTx,
  userId: string,
  interest: DeclaredInterestInput,
) {
  await tx
    .insert(declaredInterests)
    .values({
      userId,
      domain: interest.label,
      broadCategory: interest.broadCategory ?? null,
      declaredAt: new Date(),
      isActive: true,
    })
    .onConflictDoUpdate({
      target: [declaredInterests.userId, declaredInterests.domain],
      set: {
        broadCategory: interest.broadCategory ?? null,
        declaredAt: new Date(),
        isActive: true,
      },
    });

  // Seed a zero-point PlayerMastery row for the declared domain. Without
  // this, the daily-answer route's "bot questions can only deepen existing
  // territories" guard (src/app/api/daily/answer/route.ts) fires for the
  // user's very first daily, so correct answers in a freshly-declared
  // domain award 0 points and silently never open the territory.
  await tx
    .insert(playerMastery)
    .values({
      userId,
      canonicalSubcategory: interest.label,
      broadCategory: interest.broadCategory ?? null,
      totalPoints: 0,
      tier: 'establishing',
      lifetimePointsBaseline: 0,
      territoryType: 'declared',
    })
    .onConflictDoNothing({
      target: [playerMastery.userId, playerMastery.canonicalSubcategory],
    });
}

// Backstop categorization for a single interest. Re-runs the domain categorizer
// for any interest that arrived uncategorized (null/empty or a catch-all) and
// degrades to null — honest and backfillable — when categorization is
// unavailable, since categorizeInterestDomain never throws.
async function categorizeIfNeeded(interest: DeclaredInterestInput): Promise<DeclaredInterestInput> {
  if (!isCatchAllBroadCategory(interest.broadCategory)) return interest;
  const broadCategory = await categorizeInterestDomain(interest.label);
  return { ...interest, broadCategory };
}

export async function saveDeclaredInterests(userId: string, interests: DeclaredInterestInput[]) {
  const normalized = normalizeDeclaredInterests(interests);

  if (normalized.length > MAX_ACTIVE_DECLARED_INTERESTS) {
    throw new DeclaredInterestLimitError();
  }

  // Backstop categorization. saveDeclaredInterests + addDeclaredInterest are the
  // single chokepoint for every declared-interest write (onboarding + manual
  // edits + incremental adds). The upstream categorizer (canonicalizeInterest)
  // falls back to the "General Knowledge" catch-all whenever the Haiku call is
  // unavailable or returns malformed JSON, and that fabricated value used to be
  // persisted verbatim — permanently stranding the domain in the "Other
  // interests" circle, since only later gameplay re-categorizes. categorizeIfNeeded
  // re-runs the domain categorizer for any interest that arrived uncategorized.
  const categorized = await Promise.all(normalized.map(categorizeIfNeeded));

  await db.transaction(async (tx) => {
    await tx
      .update(declaredInterests)
      .set({ isActive: false })
      .where(eq(declaredInterests.userId, userId));

    for (const interest of categorized) {
      await upsertDeclaredInterestRow(tx, userId, interest);
    }
  });

  return categorized;
}

// Incrementally add one declared interest without clobbering the existing list
// (saveDeclaredInterests does a full replace). Powers the "add a topic" affordance
// on the daily setup screen. Idempotent on an already-active label, and enforces
// the same cap as the full-replace path.
export async function addDeclaredInterest(
  userId: string,
  input: DeclaredInterestInput,
): Promise<{ created: boolean; domain: string; broadCategory: string | null }> {
  const clean = normalizeDeclaredInterest(input);
  if (!clean) {
    throw new Error('Enter a topic name.');
  }

  // Last line of defense behind the client add-topic field: a bucket-level or
  // catch-all label ("Technology", "general") must never persist as a declared
  // interest. The field expands these into specific choices; this guard refuses
  // any that slip past it. (The full-replace saveDeclaredInterests path is left
  // lenient so legacy/pre-seeded rows can still be re-saved during an edit.)
  assertSpecificInterest(clean.label);

  // Companion answerability guard: refuse topics with no public factual basis
  // ("my cat", gibberish) so they never reach the daily generator. Fails open if
  // the LLM is unavailable (see assessInterestAnswerability), so an outage never
  // blocks a real add. The lenient full-replace path (saveDeclaredInterests) is
  // intentionally NOT gated, so legacy/pre-seeded rows can always be re-saved.
  await assertAnswerableInterest(clean.label);

  const active = await db
    .select({ domain: declaredInterests.domain, broadCategory: declaredInterests.broadCategory })
    .from(declaredInterests)
    .where(and(eq(declaredInterests.userId, userId), eq(declaredInterests.isActive, true)));

  const key = clean.label.toLowerCase();
  const existing = active.find((row) => row.domain.toLowerCase() === key);
  if (existing) {
    return { created: false, domain: existing.domain, broadCategory: existing.broadCategory };
  }

  if (active.length >= MAX_ACTIVE_DECLARED_INTERESTS) {
    throw new DeclaredInterestLimitError(
      `You've reached the maximum of ${MAX_ACTIVE_DECLARED_INTERESTS} interests. Remove one on your Knowledge page to add another.`,
    );
  }

  const interest = await categorizeIfNeeded(clean);

  await db.transaction(async (tx) => {
    await upsertDeclaredInterestRow(tx, userId, interest);
  });

  return { created: true, domain: interest.label, broadCategory: interest.broadCategory ?? null };
}

export async function markOnboardingComplete(userId: string) {
  await db
    .update(users)
    .set({ onboardingComplete: true, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// React.cache dedupes calls within a single server request, so the root
// layout's lookup is shared with any other server component (e.g. the
// onboarding page) that asks for the same profile during the same render.
export const getUserOnboardingProfile = cache(async (userId: string) => {
  const [user] = await db
    .select({
      id: users.id,
      phoneNumber: users.phoneNumber,
      displayName: users.displayName,
      handle: users.handle,
      timezone: users.timezone,
      preferredTheme: users.preferredTheme,
      onboardingComplete: users.onboardingComplete,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ?? null;
});

function normalizePersonName(value: string | null | undefined) {
  const normalized = value?.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 80) : null;
}

export async function getPreSeededInterestsForUser(userId: string): Promise<PreSeededInterestsForUser> {
  const [invitation] = await db
    .select({
      preSeededInterests: friendInvitations.preSeededInterests,
      inviterName: users.displayName,
      inviteeDisplayName: friendInvitations.inviteeDisplayName,
    })
    .from(friendInvitations)
    .leftJoin(users, eq(friendInvitations.inviterUserId, users.id))
    .where(and(eq(friendInvitations.inviteeUserId, userId), isNotNull(friendInvitations.acceptedAt)))
    .orderBy(desc(friendInvitations.acceptedAt))
    .limit(1);

  return {
    interests: parsePreSeededInterests(invitation?.preSeededInterests),
    inviterName: normalizePersonName(invitation?.inviterName),
    inviteeDisplayName: normalizePersonName(invitation?.inviteeDisplayName),
  };
}
