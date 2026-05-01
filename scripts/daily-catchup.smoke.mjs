import assert from 'node:assert/strict';

import {
  dailyQueueItemId,
  findQueueSlotBySlotIndex,
  isCatchupQueueDate,
  minusUtcDays,
  replaceQueueSlot,
} from '../src/server/daily/catchup.ts';

assert.equal(minusUtcDays('2026-05-01', 7), '2026-04-24');

assert.equal(isCatchupQueueDate('2026-04-30', '2026-05-01'), true);
assert.equal(isCatchupQueueDate('2026-05-01', '2026-05-01'), false);
assert.equal(isCatchupQueueDate('2026-04-24', '2026-05-01'), false);
assert.equal(isCatchupQueueDate('2026-04-23', '2026-05-01'), false);

assert.equal(dailyQueueItemId('queue-1', 3), 'queue-1:3');

const slots = [
  {
    slot_index: 3,
    source: 'bot',
    generated_question_id: 'generated-3',
    domain: 'Late Romantic Opera',
    question_text: 'Who wrote Der Rosenkavalier?',
    answered: false,
    difficulty_stepped_up: false,
  },
];

assert.equal(findQueueSlotBySlotIndex(slots, 3)?.generated_question_id, 'generated-3');
assert.equal(findQueueSlotBySlotIndex(slots, 0), null);

const answered = replaceQueueSlot(slots, 3, (slot) => ({
  ...slot,
  answered: true,
  answer_state: 'correct',
  submitted_answer: 'Strauss',
}));

assert.equal(answered[0].answered, true);
assert.equal(answered[0].submitted_answer, 'Strauss');

const dismissed = replaceQueueSlot(slots, 3, (slot) => ({
  ...slot,
  dismissed_at: '2026-05-01T12:00:00.000Z',
}));

assert.equal(dismissed[0].dismissed_at, '2026-05-01T12:00:00.000Z');
