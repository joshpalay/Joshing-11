import { describe, it, expect } from 'vitest';

import { answerCooldownKey, makeAnswerCooldownGate } from '@/server/daily/answer-cooldown';

describe('answerCooldownKey', () => {
  it('reduces an answer to a comparable head phrase', () => {
    expect(answerCooldownKey('Sarah Brown')).toBe('sarah brown');
    expect(answerCooldownKey('The Great Gatsby')).toBe('great gatsby'); // leading article stripped
    expect(answerCooldownKey('A rat (Scabbers)')).toBe('rat'); // parenthetical + article dropped
    expect(answerCooldownKey('Peter Pettigrew (Wormtail)')).toBe('peter pettigrew');
  });

  it('strips an explanatory dash tail (the real Guys and Dolls repeat)', () => {
    // The two questions that prompted this gate, four days apart — same answer,
    // different phrasing/angle, so the embedding gate let them through.
    const a = answerCooldownKey('Sarah Brown');
    const b = answerCooldownKey(
      "Sarah Brown — because Nathan thinks she's the least likely woman Sky could ever romance (a straitlaced Salvation Army missionary)",
    );
    expect(a).toBe('sarah brown');
    expect(b).toBe('sarah brown');
    expect(a).toBe(b); // collide → Tier 1 catches it
  });

  it('does NOT collide the Pettigrew pair (different answers — that is Tier 2)', () => {
    // Same subject, different facts → different answers. Tier 1 must leave these
    // alone; saturating on the subject is Tier 2's job.
    expect(answerCooldownKey('A rat (Scabbers)')).not.toBe(
      answerCooldownKey('Peter Pettigrew (Wormtail)'),
    );
  });

  it('returns empty (never blocks) for blank or generic answers', () => {
    expect(answerCooldownKey('')).toBe('');
    expect(answerCooldownKey(null)).toBe('');
    expect(answerCooldownKey(undefined)).toBe('');
    expect(answerCooldownKey('the answer')).toBe('');
    expect(answerCooldownKey('x')).toBe(''); // sub-2-char head is noise
  });
});

describe('makeAnswerCooldownGate', () => {
  it('blocks an answer the player gave within the window', () => {
    const gate = makeAnswerCooldownGate(new Set(['sarah brown']));
    expect(gate.blocks('Sarah Brown')).toBe(true);
    expect(gate.blocks('Sarah Brown — because Nathan picked the least likely doll')).toBe(true);
    expect(gate.blocks('Nathan Detroit')).toBe(false);
  });

  it('blocks a second same-answer pick within one build, but only after it is recorded', () => {
    const gate = makeAnswerCooldownGate(new Set());
    expect(gate.blocks('Sarah Brown')).toBe(false); // read-only: not yet recorded
    gate.record('Sarah Brown');
    expect(gate.blocks('Sarah Brown')).toBe(true); // now in this build
  });

  it('never blocks blank/generic answers even if recorded', () => {
    const gate = makeAnswerCooldownGate(new Set(['']));
    gate.record('the answer');
    expect(gate.blocks('')).toBe(false);
    expect(gate.blocks('the answer')).toBe(false);
  });
});
