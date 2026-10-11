import { describe, expect, it } from 'vitest';

import {
  DISPUTED_RECHECK_FALLBACK_MESSAGE,
  NEEDS_HUMAN_RECHECK_FALLBACK_MESSAGE,
  recheckVerdictText,
  REJECTED_RECHECK_FALLBACK_MESSAGE,
} from '@/lib/recheck-copy';

// QA 2026-10-11, S1: a rejected appeal left the round card with no word at all.
describe('recheckVerdictText', () => {
  it('has nothing to say without a recheck, or after an accepted one', () => {
    expect(recheckVerdictText(undefined, null)).toBeNull();
    expect(recheckVerdictText('accepted', 'Fair point.')).toBeNull();
  });

  it("uses the reviewer's reason when there is one", () => {
    expect(recheckVerdictText('rejected', 'Soil pH, not just soil.')).toBe(
      'Soil pH, not just soil.',
    );
  });

  it('falls back to the shared copy for each outcome', () => {
    expect(recheckVerdictText('rejected', null)).toBe(REJECTED_RECHECK_FALLBACK_MESSAGE);
    expect(recheckVerdictText('disputed', undefined)).toBe(DISPUTED_RECHECK_FALLBACK_MESSAGE);
    expect(recheckVerdictText('needs_human', '')).toBe(NEEDS_HUMAN_RECHECK_FALLBACK_MESSAGE);
  });
});
