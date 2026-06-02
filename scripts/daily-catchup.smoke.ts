import assert from 'node:assert/strict';

import {
  dedupeCatchUpItems,
  orderCatchUpItems,
} from '../src/server/play/catch-up-turn-sequencing';

import {
  dailyQueueItemId,
  findQueueSlotBySlotIndex,
  isCatchupQueueDate,
  minusUtcDays,
  replaceQueueSlot,
} from '../src/server/daily/catchup';
import type { QueueSlot } from '../src/server/daily/types';

assert.equal(minusUtcDays('2026-05-01', 7), '2026-04-24');

assert.equal(isCatchupQueueDate('2026-04-30', '2026-05-01'), true);
assert.equal(isCatchupQueueDate('2026-05-01', '2026-05-01'), false);
assert.equal(isCatchupQueueDate('2026-04-24', '2026-05-01'), false);
assert.equal(isCatchupQueueDate('2026-04-23', '2026-05-01'), false);

assert.equal(dailyQueueItemId('queue-1', 3), 'queue-1:3');

const slots: QueueSlot[] = [
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

const duplicateCatchupItems = [
  {
    dailyQueueItemId: 'queue-1:0',
    queueDate: '2026-04-29',
    wasSkipped: false,
    questionId: 'generated-synergy-1',
    questionText: 'In the 1980s cartoon Jem, what was the holographic computer called?',
    correctAnswer: 'Synergy',
    domain: '1980s Animation',
  },
  {
    dailyQueueItemId: 'queue-2:0',
    queueDate: '2026-04-30',
    wasSkipped: false,
    questionId: 'generated-synergy-2',
    questionText: 'Jerrica Benton became Jem with help from which holographic computer?',
    correctAnswer: 'Synergy',
    domain: '1980s Animation',
  },
  {
    dailyQueueItemId: 'queue-3:0',
    queueDate: '2026-04-30',
    wasSkipped: true,
    questionId: 'generated-bach',
    questionText: 'Who composed the Mass in B minor?',
    correctAnswer: 'Bach',
    domain: 'Classical Music',
  },
];

const sortedCatchupItems = orderCatchUpItems(duplicateCatchupItems);
assert.equal(sortedCatchupItems[0].dailyQueueItemId, 'queue-3:0');

const dedupedCatchupItems = dedupeCatchUpItems(sortedCatchupItems);
assert.equal(dedupedCatchupItems.length, 2);
assert.deepEqual(
  dedupedCatchupItems.map((item) => item.dailyQueueItemId),
  ['queue-3:0', 'queue-1:0'],
);

console.log('daily-catchup.smoke: ok');
