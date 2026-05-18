import { describe, expect, it } from 'vitest';
import {
  buildScoreLine,
  buildInterpretiveLine,
  buildSessionCloseLines,
  type SessionSlotSummary,
} from '@/server/mastery/session-close-copy';

function slot(partial: Partial<SessionSlotSummary> & { answer_state: SessionSlotSummary['answer_state'] }): SessionSlotSummary {
  return { domain: 'History', ...partial };
}

describe('buildScoreLine', () => {
  it('5/5 is Untouched', () => {
    expect(buildScoreLine(5)).toBe('Untouched.');
  });
  it('4/5 is Strong', () => {
    expect(buildScoreLine(4)).toBe('Strong.');
  });
  it('3/5 is Solid', () => {
    expect(buildScoreLine(3)).toBe('Solid.');
  });
  it('2/5 is Working ground', () => {
    expect(buildScoreLine(2)).toBe('Working ground.');
  });
  it('1/5 and 0/5 share the same line', () => {
    expect(buildScoreLine(1)).toBe("Tomorrow's another five.");
    expect(buildScoreLine(0)).toBe("Tomorrow's another five.");
  });
});

describe('buildInterpretiveLine', () => {
  it('returns null when nothing qualifies (mixed 2/5 with no streak or domain wipe)', () => {
    const slots: SessionSlotSummary[] = [
      slot({ answer_state: 'correct', domain: 'A' }),
      slot({ answer_state: 'incorrect', domain: 'B' }),
      slot({ answer_state: 'correct', domain: 'C' }),
      slot({ answer_state: 'incorrect', domain: 'D' }),
      slot({ answer_state: 'incorrect', domain: 'E' }),
    ];
    expect(buildInterpretiveLine(slots)).toBeNull();
  });

  it('returns Clean sweep for 5/5', () => {
    const slots = Array.from({ length: 5 }, (_, i) => slot({ answer_state: 'correct', domain: `D${i}` }));
    expect(buildInterpretiveLine(slots)).toBe('Clean sweep.');
  });

  it('returns wipeout for 0/5', () => {
    const slots = Array.from({ length: 5 }, (_, i) => slot({ answer_state: 'incorrect', domain: `D${i}` }));
    expect(buildInterpretiveLine(slots)).toBe('Every one of them. Tomorrow.');
  });

  it('returns streak copy for 3 in a row', () => {
    const slots: SessionSlotSummary[] = [
      slot({ answer_state: 'incorrect', domain: 'A' }),
      slot({ answer_state: 'correct', domain: 'B' }),
      slot({ answer_state: 'correct', domain: 'C' }),
      slot({ answer_state: 'correct', domain: 'D' }),
      slot({ answer_state: 'incorrect', domain: 'E' }),
    ];
    expect(buildInterpretiveLine(slots)).toBe('Three in a row at one point.');
  });

  it('returns domain-deep-look copy when all answers in one domain are wrong', () => {
    const slots: SessionSlotSummary[] = [
      slot({ answer_state: 'correct', domain: 'A' }),
      slot({ answer_state: 'incorrect', domain: 'Late Tchaikovsky' }),
      slot({ answer_state: 'incorrect', domain: 'Late Tchaikovsky' }),
      slot({ answer_state: 'correct', domain: 'A' }),
      slot({ answer_state: 'correct', domain: 'A' }),
    ];
    expect(buildInterpretiveLine(slots)).toBe('Late Tchaikovsky is worth a deeper look.');
  });

  it('prioritizes tier crossing over slot-derived signals', () => {
    const slots: SessionSlotSummary[] = Array.from({ length: 5 }, (_, i) => slot({
      answer_state: 'correct',
      domain: `D${i}`,
    }));
    slots[0] = { ...slots[0], tier_crossed: true, new_tier: 'familiar', domain: 'Late Tchaikovsky' };
    expect(buildInterpretiveLine(slots)).toBe('You moved to Familiar in Late Tchaikovsky.');
  });

  it('prioritizes new demonstrated domain over slot-derived signals', () => {
    const slots: SessionSlotSummary[] = Array.from({ length: 5 }, (_, i) => slot({
      answer_state: 'correct',
      domain: `D${i}`,
    }));
    slots[2] = { ...slots[2], is_first_in_new_demonstrated_domain: true, domain: 'Geology' };
    expect(buildInterpretiveLine(slots)).toBe('New ground: Geology is yours now.');
  });
});

describe('buildSessionCloseLines', () => {
  it('produces both layers', () => {
    const slots: SessionSlotSummary[] = Array.from({ length: 5 }, (_, i) => slot({ answer_state: 'correct', domain: `D${i}` }));
    expect(buildSessionCloseLines(slots)).toEqual({
      scoreLine: 'Untouched.',
      interpretiveLine: 'Clean sweep.',
    });
  });
});
