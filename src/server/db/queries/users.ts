import type { InferSelectModel } from 'drizzle-orm';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { cache } from 'react';

import { db, declaredInterests, friendInvitations, playerMastery, users } from '@/server/db';
import { categorizeInterestDomain, isCatchAllBroadCategory } from '@/server/llm/interests';
import { foldDomainPunctuation } from '@/lib/knowledge/domain-key';

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

export async function saveDeclaredInterests(userId: string, interests: DeclaredInterestInput[]) {
  const normalized = normalizeDeclaredInterests(interests);

  if (normalized.length > 5) {
    throw new Error('A player can have at most 5 active declared interests.');
  }

  // Backstop categorization. This is the single chokepoint for every declared-
  // interest write (onboarding + manual edits). The upstream categorizer
  // (canonicalizeInterest) falls back to the "General Knowledge" catch-all
  // whenever the Haiku call is unavailable or returns malformed JSON, and that
  // fabricated value used to be persisted verbatim — permanently stranding the
  // domain in the "Other interests" circle, since only later gameplay
  // re-categorizes. Re-run the domain categorizer for any interest that arrived
  // uncategorized (null/empty or a catch-all) and persist null — honest and
  // backfillable — only when categorization is genuinely unavailable.
  // categorizeInterestDomain never throws, so a transient LLM blip degrades to
  // null rather than failing the save.
  const categorized = await Promise.all(
    normalized.map(async (interest) => {
      if (!isCatchAllBroadCategory(interest.broadCategory)) return interest;
      const broadCategory = await categorizeInterestDomain(interest.label);
      return { ...interest, broadCategory };
    }),
  );

  await db.transaction(async (tx) => {
    await tx
      .update(declaredInterests)
      .set({ isActive: false })
      .where(eq(declaredInterests.userId, userId));

    for (const interest of categorized) {
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
  });

  return categorized;
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
