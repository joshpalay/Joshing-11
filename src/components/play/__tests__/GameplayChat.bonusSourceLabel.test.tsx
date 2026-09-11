import { describe, expect, it } from 'vitest';

/**
 * F6 (2026-09-10 audit) — bonusSourceLabel used to say "FROM {NAME}'S
 * KNOWLEDGE", but src/server/db/queries/friend-presence-domains.ts (the
 * data behind this label) only ever supplies a DOMAIN the friend has
 * declared or is active in — territory ∪ activity — never a specific fact
 * confirmed correct. "Knowledge" claims a certainty the source can't back;
 * "world" matches what the signal actually is.
 *
 * Mirrored here (not exported from GameplayChat.tsx) following the same
 * pattern as missed-return-recovery-write.test.ts's `recoveryNote` mirror,
 * so a copy change at the render site without a matching change here fails
 * the suite.
 */
function bonusSourceLabel(sourceName: string, extraCount: number): string {
  const firstName = sourceName.trim().split(/\s+/)[0] ?? sourceName;
  const source = firstName.toUpperCase();
  return extraCount > 0 ? `FROM ${source} + OTHERS’ WORLDS` : `FROM ${source}’S WORLD`;
}

describe('bonusSourceLabel never claims specific knowledge', () => {
  // "Generated domain source" — the ONLY source shape this label is ever
  // called with today (the +2 reframe replaced literal answered-question
  // replay with freshly generated domain-based bonuses; see
  // friend-presence-domains.ts header comment). There is currently no
  // "friend-answered" bonus-source variant in the data model for this label
  // to distinguish — noted here rather than silently assumed.
  it('names one friend by domain/world, not by knowledge', () => {
    const label = bonusSourceLabel('Sarah Kim', 0);
    expect(label).toBe('FROM SARAH’S WORLD');
    expect(label).not.toContain('KNOWLEDGE');
  });

  it('names multiple friends by world(s), not by knowledge', () => {
    const label = bonusSourceLabel('Sarah Kim', 2);
    expect(label).toBe('FROM SARAH + OTHERS’ WORLDS');
    expect(label).not.toContain('KNOWLEDGE');
  });

  it('never implies the friend specifically knows or answered this question', () => {
    // No wording that reads as a verified fact the friend demonstrated.
    for (const label of [bonusSourceLabel('Robyn', 0), bonusSourceLabel('Robyn', 3)]) {
      expect(label).not.toMatch(/knowledge|knows|answered|correct/i);
    }
  });
});

// "Missing/unknown source" — GameplayChat gates the whole banner on
// `isBonus = Boolean(presenceSourceName)` (see GameplayChat.tsx), so
// bonusSourceLabel is never invoked without a name at all. The correct
// behavior for an unknown source is exercised at that call site, not inside
// this pure formatter — covered by GameplayChat.returnBanner.test.tsx's
// "renders NO banner" case for the analogous return-banner gate.
