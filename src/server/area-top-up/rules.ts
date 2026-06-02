// Pure, dependency-free business rules for the one-time "add two more areas"
// prompt. Kept free of DB/network imports so it can be unit/smoke-tested in
// isolation (see scripts/area-top-up.smoke.mjs). The DB query in
// ./area-top-up.ts and the suggestions route both reuse these helpers.

// Invite-seeded users start with exactly this many declared interests (the
// inviter's pre-seeded suggestions, capped at 3). Only users sitting at this
// exact count are offered the one-time top-up prompt — the product decision
// is "exactly 3 → top up to 5".
export const AREA_TOP_UP_TRIGGER_COUNT = 3;
// The DeclaredInterest cap enforced by saveDeclaredInterests. The top-up
// prompt lets a user add up to (MAX - TRIGGER) = 2 more areas.
export const AREA_TOP_UP_MAX_INTERESTS = 5;

export type AreaTopUpEligibilityInput = {
  onboardingComplete: boolean;
  // The dismissal timestamp from User.area_top_up_prompt_dismissed_at. A
  // non-null value (the user already saw and resolved the prompt) makes them
  // ineligible — the prompt is strictly one-time.
  dismissedAt: Date | string | null;
  activeInterestCount: number;
};

// The core eligibility rule. A user sees the prompt exactly once, the next
// time they play after onboarding, only while they sit at the trigger count.
export function isAreaTopUpEligible({
  onboardingComplete,
  dismissedAt,
  activeInterestCount,
}: AreaTopUpEligibilityInput): boolean {
  return (
    onboardingComplete === true &&
    dismissedAt === null &&
    activeInterestCount === AREA_TOP_UP_TRIGGER_COUNT
  );
}

// How many more areas the user may add, clamped to [0, MAX]. Used to cap the
// picker and to short-circuit the modal when there is no room left.
export function remainingTopUpSlots(activeInterestCount: number): number {
  return Math.max(0, AREA_TOP_UP_MAX_INTERESTS - activeInterestCount);
}

// Drops any proposed suggestion whose domain the user already declared
// (case-insensitive) and trims to `limit`, so we never offer a duplicate.
export function filterTopUpSuggestions<T extends { domain: string }>(
  proposed: T[],
  existingDomains: Iterable<string>,
  limit = 8,
): T[] {
  const taken = new Set<string>();
  for (const domain of existingDomains) {
    taken.add(domain.trim().toLowerCase());
  }
  return proposed.filter((item) => !taken.has(item.domain.trim().toLowerCase())).slice(0, limit);
}
