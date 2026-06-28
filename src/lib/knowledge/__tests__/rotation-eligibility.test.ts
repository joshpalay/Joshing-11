import { describe, expect, it } from 'vitest';

import { masteryDomainFeedsRotation } from '@/lib/knowledge/rotation-eligibility';

describe('masteryDomainFeedsRotation (B-DOMAIN-BONUS-ROTATION-01)', () => {
  it('keeps a bonus-only domain OUT of the core rotation until claimed', () => {
    // Freshly opened by a +2 bonus answer: rotation_eligible=false, not declared,
    // no frequency set. This is the leak the fix closes.
    expect(
      masteryDomainFeedsRotation({ rotationEligible: false, declared: false, adopted: false }),
    ).toBe(false);
  });

  it('re-includes a bonus domain once the player ADOPTS it (any non-resting frequency)', () => {
    expect(
      masteryDomainFeedsRotation({ rotationEligible: false, declared: false, adopted: true }),
    ).toBe(true);
  });

  it('re-includes a bonus domain once the player DECLARES it', () => {
    expect(
      masteryDomainFeedsRotation({ rotationEligible: false, declared: true, adopted: false }),
    ).toBe(true);
  });

  it('always keeps a rotation-eligible domain (core/feed/declared play, or legacy rows)', () => {
    // Legacy + every non-bonus surface write defaults rotation_eligible=true, so
    // existing demonstrated domains are never dropped by the new guard.
    expect(
      masteryDomainFeedsRotation({ rotationEligible: true, declared: false, adopted: false }),
    ).toBe(true);
  });
});
