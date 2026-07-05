import { describe, expect, it } from 'vitest';

import { parseSalvageResponse } from '@/server/quality/salvage-question';

describe('parseSalvageResponse', () => {
  it('parses a stem fix', () => {
    const out = parseSalvageResponse(
      JSON.stringify({
        kind: 'extra_fact_stem',
        proposed_stem: 'Which anthology, edited by Barbara Smith, is a landmark of Black lesbian feminism?',
        proposed_explanation: null,
        note: 'removed the wrong "1973"',
      }),
    );
    expect(out).toEqual({
      kind: 'extra_fact_stem',
      proposedStem: 'Which anthology, edited by Barbara Smith, is a landmark of Black lesbian feminism?',
      proposedExplanation: null,
      note: 'removed the wrong "1973"',
    });
  });

  it('parses an explainer-only fix', () => {
    const out = parseSalvageResponse(
      JSON.stringify({
        kind: 'extra_fact_explainer',
        proposed_stem: null,
        proposed_explanation: 'Corrected context without the wrong date.',
        note: 'fixed the airlift duration',
      }),
    );
    expect(out?.kind).toBe('extra_fact_explainer');
    expect(out?.proposedStem).toBeNull();
    expect(out?.proposedExplanation).toBe('Corrected context without the wrong date.');
  });

  it('passes through unsalvageable with no proposed text', () => {
    const out = parseSalvageResponse(
      JSON.stringify({ kind: 'unsalvageable', proposed_stem: null, proposed_explanation: null, note: 'answer is wrong' }),
    );
    expect(out).toEqual({
      kind: 'unsalvageable',
      proposedStem: null,
      proposedExplanation: null,
      note: 'answer is wrong',
    });
  });

  it('demotes a "fix" that proposes NO changed text to unsalvageable', () => {
    // A salvage with a salvageable kind but no stem AND no explainer is a no-op —
    // never surface it as a fix.
    const out = parseSalvageResponse(
      JSON.stringify({ kind: 'extra_fact_stem', proposed_stem: '  ', proposed_explanation: null, note: 'x' }),
    );
    expect(out?.kind).toBe('unsalvageable');
  });

  it('rejects an unknown kind', () => {
    expect(
      parseSalvageResponse(JSON.stringify({ kind: 'whatever', proposed_stem: 'x' })),
    ).toBeNull();
  });

  it('rejects malformed JSON', () => {
    expect(parseSalvageResponse('not json')).toBeNull();
  });

  it('caps the note length', () => {
    const out = parseSalvageResponse(
      JSON.stringify({ kind: 'extra_fact_stem', proposed_stem: 'ok', proposed_explanation: null, note: 'z'.repeat(500) }),
    );
    expect((out?.note.length ?? 0) <= 300).toBe(true);
  });
});
