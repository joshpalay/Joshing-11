import test from 'node:test';
import assert from 'node:assert/strict';
import { historyKey, precheck } from '../cassian-precheck-replay.mjs';

const card = {
  schemaVersion: 3,
  id: 'card-1',
  question: 'Which instrument plays this passage?',
  answer: 'Violin',
  explanation: 'The supplied passage names the violin.',
  variants: [],
};

test('passes a complete card with no exact historical repeat', () => {
  assert.equal(precheck(card, 'card-1', new Set()), null);
});

test('stops only mechanical required-field failures', () => {
  assert.equal(precheck({ ...card, explanation: ' ' }, 'card-1', new Set()), 'required-text');
  assert.equal(precheck({ ...card, variants: [''] }, 'card-1', new Set()), 'required-variants');
  assert.equal(precheck({ ...card, id: 'other' }, 'card-1', new Set()), 'required-schema-or-id');
});

test('stops an exact question and answer repeat after narrow normalization', () => {
  const history = new Set([historyKey('WHICH  instrument plays this passage?', 'Violin')]);
  assert.equal(precheck(card, 'card-1', history), 'exact-history-repeat');
});

test('passes ambiguous similarity and an answer change to source review', () => {
  const history = new Set([historyKey('Which instrument performs this passage?', 'Violin')]);
  assert.equal(precheck(card, 'card-1', history), null);
  history.add(historyKey(card.question, 'Viola'));
  assert.equal(precheck(card, 'card-1', history), null);
});
