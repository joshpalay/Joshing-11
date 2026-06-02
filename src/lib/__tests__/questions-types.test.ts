import { describe, expect, it } from 'vitest';

import {
  HOUSE_AUTHOR,
  LLM_QUESTION_ATTRIBUTION,
  QUESTION_SOURCES,
  isHouseAttribution,
  parseQuestionSource,
  resolveQuestionAuthor,
} from '@/lib/questions-types';

describe('parseQuestionSource', () => {
  it('accepts every QuestionSource value', () => {
    for (const source of QUESTION_SOURCES) {
      expect(parseQuestionSource(source)).toBe(source);
    }
    expect(QUESTION_SOURCES).toContain('house_authored');
  });

  it('throws on an unknown stored value rather than misrouting it', () => {
    expect(() => parseQuestionSource('synthetic_peer')).toThrow();
    expect(() => parseQuestionSource('')).toThrow();
  });
});

describe('resolveQuestionAuthor', () => {
  const user = { id: 'user-1', displayName: 'Ada' };

  it('resolves a human author when creatorId is set, regardless of source', () => {
    const resolved = resolveQuestionAuthor({ creatorId: 'user-1', source: 'authored', user });
    expect(resolved).toEqual({ kind: 'human', user });
  });

  it('resolves the house identity for (null, house_authored)', () => {
    const resolved = resolveQuestionAuthor({ creatorId: null, source: 'house_authored', user });
    expect(resolved).toEqual({ kind: 'house', displayName: 'Joshing', label: 'Editorial' });
  });

  it('resolves the non-person Generated treatment for null-creator LLM origins', () => {
    for (const source of ['daily_generated', 'curated_sent'] as const) {
      expect(resolveQuestionAuthor({ creatorId: null, source, user })).toEqual({
        kind: 'generated',
        name: LLM_QUESTION_ATTRIBUTION,
      });
    }
  });

  // Invariant H-1: a house question must never resolve to the 'A friend' fallback
  // or to a users row. The resolver makes this true by construction.
  it('Invariant H-1: a house question never resolves to a users row or "A friend"', () => {
    const resolved = resolveQuestionAuthor({ creatorId: null, source: 'house_authored', user });
    expect(resolved.kind).toBe('house');
    expect(JSON.stringify(resolved)).not.toContain('A friend');
    expect('user' in resolved).toBe(false);
    if (resolved.kind === 'house') {
      expect(resolved.displayName).toBe(HOUSE_AUTHOR.displayName);
      expect(resolved.label).toBe(HOUSE_AUTHOR.label);
    }
  });

  it('never resolves a house question to the LLM Generated label', () => {
    const resolved = resolveQuestionAuthor({ creatorId: null, source: 'house_authored', user });
    expect(resolved.kind).not.toBe('generated');
  });
});

describe('isHouseAttribution', () => {
  it('matches the house display name and nothing else', () => {
    expect(isHouseAttribution(HOUSE_AUTHOR.displayName)).toBe(true);
    expect(isHouseAttribution('  Joshing  ')).toBe(true);
    expect(isHouseAttribution(LLM_QUESTION_ATTRIBUTION)).toBe(false);
    expect(isHouseAttribution('Ada')).toBe(false);
    expect(isHouseAttribution(null)).toBe(false);
  });

  it('keeps the house identity distinct from a users.id (sentinel, never an FK)', () => {
    expect(HOUSE_AUTHOR.id).toBe('house');
    expect(HOUSE_AUTHOR.kind).toBe('house');
  });
});
