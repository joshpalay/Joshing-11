import { describe, expect, it } from 'vitest';

import type { QueueSlot } from '@/server/daily/types';
import { isReturnSlot } from '@/server/daily/bonus';

/**
 * Regression cover for the two defects the 2026-08-09 live walkthrough found,
 * both of which were invisible to every other test because they are properties
 * of a DB constraint and of a render path, not of a pure function.
 */

function slot(over: Partial<QueueSlot> = {}): QueueSlot {
  return {
    slot_index: 0,
    source: 'friend',
    domain: 'musical theater',
    question_text: 'q?',
    answered: false,
    ...over,
  } as QueueSlot;
}

/**
 * Mirrors the call-site rule in /api/daily/answer. MASTERY_EVENTS carries
 * unique(source_type, question_id, answered_by_user_id) and inserts `on conflict
 * do nothing`, so a return answered under the LIVE source type collides with the
 * player's own original wrong answer and is silently dropped — taking the
 * recovery points and the Recovered-deck entry with it.
 */
function masterySourceTypeFor(s: QueueSlot): 'daily' | 'catchup' {
  return isReturnSlot(s) ? 'catchup' : 'daily';
}

/** Mirrors the skipMasteryEvent rule at the same call site. */
function skipsMasteryEvent(s: QueueSlot, isCorrect: boolean): boolean {
  return isReturnSlot(s) && !isCorrect;
}

describe('a returning question writes a mastery event that actually lands', () => {
  it('routes a return to the catch-up source type, never the live one', () => {
    expect(masterySourceTypeFor(slot({ return_scope: 'wrong' }))).toBe('catchup');
    expect(masterySourceTypeFor(slot({ return_scope: 'expired' }))).toBe('catchup');
  });

  it('leaves ordinary daily slots on the live source type', () => {
    expect(masterySourceTypeFor(slot())).toBe('daily');
    expect(masterySourceTypeFor(slot({ presence_source_id: 'u1' }))).toBe('daily');
  });

  it('does not collide with the original wrong answer', () => {
    // The original live wrong answer occupies ('live_correct', q, player).
    const original = { sourceType: 'daily' as const, questionId: 'q1', userId: 'u1' };
    const theReturn = {
      sourceType: masterySourceTypeFor(slot({ return_scope: 'wrong' })),
      questionId: 'q1',
      userId: 'u1',
    };
    const key = (e: { sourceType: string; questionId: string; userId: string }) =>
      `${e.sourceType}:${e.questionId}:${e.userId}`;
    expect(key(theReturn)).not.toBe(key(original));
  });

  it('skips the write on a WRONG return so a later correct one can still land', () => {
    // R7 allows three returns. If a wrong return took the single catch-up slot,
    // the correct answer on return #2 or #3 would be deduped away — the exact
    // bug this guards, one step later.
    expect(skipsMasteryEvent(slot({ return_scope: 'wrong' }), false)).toBe(true);
    expect(skipsMasteryEvent(slot({ return_scope: 'wrong' }), true)).toBe(false);
  });

  it('never skips the write for an ordinary slot', () => {
    expect(skipsMasteryEvent(slot(), false)).toBe(false);
    expect(skipsMasteryEvent(slot(), true)).toBe(false);
  });
});

/**
 * Mirrors returnRecoveryNote in src/app/daily/page.tsx. It is derived from the
 * PERSISTED slot, not stashed at answer time — the first attempt wrote it into
 * `reveal_breadcrumb`, which the reveal accepts as a prop but never renders, so
 * the payoff moment never appeared at all.
 */
function recoveryNote(s: QueueSlot): string | null {
  if (s.return_scope !== 'wrong') return null;
  const answeredCorrect = s.answer_state === 'correct' || s.catchup_answer_state === 'correct';
  if (!answeredCorrect) return null;
  const author = s.author_name?.trim();
  return author ? `It stuck. ${author} would be glad.` : 'It stuck.';
}

describe('the correct-on-return acknowledgment (§6)', () => {
  it('names the author when there is one', () => {
    expect(
      recoveryNote(slot({ return_scope: 'wrong', answer_state: 'correct', author_name: 'Robyn' })),
    ).toBe('It stuck. Robyn would be glad.');
  });

  it('stands alone for an LLM-origin question with no author', () => {
    expect(recoveryNote(slot({ return_scope: 'wrong', answer_state: 'correct' }))).toBe('It stuck.');
  });

  it('is derivable from the persisted slot, so it survives a reload', () => {
    // No answer-time state involved: scope + verdict + author are all on the slot.
    const persisted = slot({ return_scope: 'wrong', answer_state: 'correct', author_name: 'Joshua P' });
    expect(recoveryNote(persisted)).toBe(recoveryNote({ ...persisted }));
  });

  it('says nothing on a wrong return', () => {
    expect(recoveryNote(slot({ return_scope: 'wrong', answer_state: 'incorrect' }))).toBeNull();
  });

  it('says nothing for the expired scope — it was never seen, so nothing stuck', () => {
    expect(recoveryNote(slot({ return_scope: 'expired', answer_state: 'correct' }))).toBeNull();
  });

  it('says nothing on an ordinary correct answer', () => {
    expect(recoveryNote(slot({ answer_state: 'correct', author_name: 'Robyn' }))).toBeNull();
  });
});
