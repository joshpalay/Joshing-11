import { describe, it, expect } from 'vitest';

import { entityKey, makeSubjectCooldownGate } from '@/server/daily/subject-cooldown';

describe('entityKey', () => {
  it('folds subjects and answers into one comparable key space', () => {
    // The same entity named as a SUBJECT in one question and as an ANSWER in
    // another must fold to the same key — that is the whole mechanism.
    expect(entityKey('Peter Pettigrew')).toBe('peter pettigrew');
    expect(entityKey('Peter Pettigrew (Wormtail)')).toBe('peter pettigrew');
    expect(entityKey('Peter Pettigrew')).toBe(entityKey('Peter Pettigrew (Wormtail)'));
  });
});

describe('makeSubjectCooldownGate', () => {
  // Recent history from the rat question (answered earlier): its subject "Peter
  // Pettigrew" and answer "a rat" both enter the entity set.
  const recent = new Set(['peter pettigrew', 'rat']);

  it('catches the Pettigrew case via the answer↔subject cross-match', () => {
    const gate = makeSubjectCooldownGate(recent);
    // The Marauder's Map question: subject is "the Marauder's Map" (no match),
    // but its ANSWER is "Peter Pettigrew" — which was the SUBJECT of the recent
    // rat question. The cross-match is what catches it.
    expect(gate.blocks("Marauder's Map", 'Peter Pettigrew (Wormtail)')).toBe(true);
  });

  it('blocks a candidate whose SUBJECT matches a recently-touched entity', () => {
    const gate = makeSubjectCooldownGate(recent);
    expect(gate.blocks('Peter Pettigrew', 'some unrelated answer')).toBe(true);
  });

  it('does not block an unrelated question', () => {
    const gate = makeSubjectCooldownGate(recent);
    expect(gate.blocks('Sirius Black', 'a motorcycle')).toBe(false);
  });

  it('blocks a second same-subject question within one build once recorded', () => {
    const gate = makeSubjectCooldownGate(new Set());
    expect(gate.blocks('Nathan Detroit', 'Sarah Brown')).toBe(false);
    gate.record('Nathan Detroit', 'Sarah Brown');
    // A later question about Nathan Detroit (subject) OR answered "Sarah Brown"
    // is now spaced out within this build.
    expect(gate.blocks('Nathan Detroit', 'somewhere else')).toBe(true);
    expect(gate.blocks('Adelaide', 'Sarah Brown')).toBe(true);
  });

  it('never blocks when both subject and answer are blank/generic', () => {
    const gate = makeSubjectCooldownGate(new Set(['']));
    expect(gate.blocks(null, '')).toBe(false);
    expect(gate.blocks('', 'the answer')).toBe(false);
  });
});
