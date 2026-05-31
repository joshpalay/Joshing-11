import { eq } from 'drizzle-orm';

import { db, users } from '@/server/db';
import { getActiveDeclaredInterests } from '@/server/db/queries/declared-interests';

// Invite-seeded users start with exactly this many declared interests (the
// inviter's pre-seeded suggestions, capped at 3). Only users sitting at this
// exact count are offered the one-time top-up prompt — see the product
// decision in the plan: "exactly 3 → top up to 5".
export const AREA_TOP_UP_TRIGGER_COUNT = 3;
// The DeclaredInterest cap enforced by saveDeclaredInterests. The top-up
// prompt lets a user add up to (MAX - TRIGGER) = 2 more areas.
export const AREA_TOP_UP_MAX_INTERESTS = 5;

export type ExistingInterest = {
  domain: string;
  broadCategory: string | null;
};

export type CulturalAnchorContext = {
  birthYear: number;
  grewUpCountry: string;
  grewUpRegion: string | null;
};

export type AreaTopUpContext = {
  // True when the user has finished onboarding, sits at exactly the trigger
  // count of active interests, and has not already dismissed/completed the
  // prompt.
  eligible: boolean;
  existing: ExistingInterest[];
  anchor: CulturalAnchorContext | null;
};

// Loads everything both the eligibility check and the suggestion generator
// need in a single pass: onboarding state, the dismissal flag, the user's
// current declared interests, and the stored cultural anchor.
export async function getAreaTopUpContext(userId: string): Promise<AreaTopUpContext | null> {
  const [user] = await db
    .select({
      onboardingComplete: users.onboardingComplete,
      dismissedAt: users.areaTopUpPromptDismissedAt,
      birthYear: users.birthYear,
      grewUpCountry: users.grewUpCountry,
      grewUpRegion: users.grewUpRegion,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) return null;

  const interests = await getActiveDeclaredInterests(userId);
  const existing: ExistingInterest[] = interests.map((interest) => ({
    domain: interest.domain,
    broadCategory: interest.broadCategory,
  }));

  const eligible =
    user.onboardingComplete === true &&
    user.dismissedAt === null &&
    existing.length === AREA_TOP_UP_TRIGGER_COUNT;

  const anchor: CulturalAnchorContext | null =
    typeof user.birthYear === 'number' && user.grewUpCountry
      ? {
          birthYear: user.birthYear,
          grewUpCountry: user.grewUpCountry,
          grewUpRegion: user.grewUpRegion,
        }
      : null;

  return { eligible, existing, anchor };
}

// Stamps the one-time dismissal so the prompt never reappears. Called both
// when the user saves new areas and when they skip the prompt.
export async function dismissAreaTopUpPrompt(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ areaTopUpPromptDismissedAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, userId));
}
