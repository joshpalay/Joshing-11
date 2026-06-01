import assert from 'node:assert/strict';

import {
  AREA_TOP_UP_MAX_INTERESTS,
  AREA_TOP_UP_TRIGGER_COUNT,
  filterTopUpSuggestions,
  isAreaTopUpEligible,
  remainingTopUpSlots,
} from '../src/server/area-top-up/rules.ts';

// --- Constants -------------------------------------------------------------
// Invite-seeded users start at 3 interests; the app caps at 5, so a fully
// taken-up user can add exactly 2 more.
assert.equal(AREA_TOP_UP_TRIGGER_COUNT, 3);
assert.equal(AREA_TOP_UP_MAX_INTERESTS, 5);

// --- isAreaTopUpEligible ---------------------------------------------------
// The happy path: onboarded, never dismissed, sitting at exactly 3 interests.
assert.equal(
  isAreaTopUpEligible({ onboardingComplete: true, dismissedAt: null, activeInterestCount: 3 }),
  true,
);

// Not yet onboarded — never prompt mid-onboarding.
assert.equal(
  isAreaTopUpEligible({ onboardingComplete: false, dismissedAt: null, activeInterestCount: 3 }),
  false,
);

// Already dismissed/completed — the prompt is strictly one-time, regardless of
// whether the timestamp arrives as a Date or an ISO string.
assert.equal(
  isAreaTopUpEligible({
    onboardingComplete: true,
    dismissedAt: new Date(),
    activeInterestCount: 3,
  }),
  false,
);
assert.equal(
  isAreaTopUpEligible({
    onboardingComplete: true,
    dismissedAt: '2026-05-31T00:00:00.000Z',
    activeInterestCount: 3,
  }),
  false,
);

// Wrong interest count — only users at exactly the trigger count qualify.
for (const activeInterestCount of [0, 1, 2, 4, 5, 6]) {
  assert.equal(
    isAreaTopUpEligible({ onboardingComplete: true, dismissedAt: null, activeInterestCount }),
    false,
    `count ${activeInterestCount} should be ineligible`,
  );
}

// --- remainingTopUpSlots ---------------------------------------------------
assert.equal(remainingTopUpSlots(3), 2); // the canonical invite case
assert.equal(remainingTopUpSlots(0), 5);
assert.equal(remainingTopUpSlots(4), 1);
assert.equal(remainingTopUpSlots(5), 0);
assert.equal(remainingTopUpSlots(7), 0); // clamped, never negative

// --- filterTopUpSuggestions ------------------------------------------------
const proposed = [
  { domain: 'Late Tchaikovsky', broadCategory: 'Music' },
  { domain: 'Weimar-Era Cinema', broadCategory: 'Film & Television' },
  { domain: 'Modernist American Poetry', broadCategory: 'Literature' },
];

// Drops a domain the user already declared, case-insensitively and ignoring
// surrounding whitespace; preserves the order of what remains.
const filtered = filterTopUpSuggestions(proposed, ['  late tchaikovsky ']);
assert.deepEqual(
  filtered.map((item) => item.domain),
  ['Weimar-Era Cinema', 'Modernist American Poetry'],
);

// Nothing taken — everything passes through, order intact.
assert.deepEqual(
  filterTopUpSuggestions(proposed, []).map((item) => item.domain),
  ['Late Tchaikovsky', 'Weimar-Era Cinema', 'Modernist American Poetry'],
);

// Respects the limit argument.
assert.equal(filterTopUpSuggestions(proposed, [], 2).length, 2);

console.log('area-top-up smoke test passed');
