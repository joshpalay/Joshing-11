import { describe, expect, it } from 'vitest';

import { parseQuestions } from '@/server/daily/generate-questions';

function validQuestion(overrides: Record<string, unknown> = {}) {
  return {
    canonical_subcategory: 'Puccini Operas',
    broad_category: 'Music',
    question_text: 'In Tosca, which character is Rome’s chief of police?',
    answer: 'Baron Scarpia',
    explainer: 'Scarpia is the opera’s chief of police and principal antagonist.',
    difficulty_estimate: 'accessible',
    fact_key: 'tosca-scarpia-chief-of-police',
    subject_entity: 'Baron Scarpia',
    sub_angles: ['Scarpia', 'Rome police chief'],
    question_shape: 'identification',
    ...overrides,
  };
}

describe('generated question contract', () => {
  it('accepts a complete single-answer question', () => {
    const parsed = parseQuestions(JSON.stringify({ questions: [validQuestion()] }));
    expect(parsed).toHaveLength(1);
  });

  it.each([
    ['fact key', { fact_key: null }],
    ['question shape', { question_shape: null }],
    ['unsupported list shape', { question_shape: 'name_multiple' }],
  ])('rejects missing or unsupported %s metadata', (_label, override) => {
    const parsed = parseQuestions(JSON.stringify({ questions: [validQuestion(override)] }));
    expect(parsed).toEqual([]);
  });

  it('rejects a missing subject_entity (required since 2026-09-16)', () => {
    // R7 subject coverage, the subject-cooldown gate, pool dedup's fact_key-drift
    // corroboration and the bank same-fact gate all read this column; a null
    // row is invisible to every one of them.
    const parsed = parseQuestions(JSON.stringify({
      questions: [validQuestion({ subject_entity: null })],
    }));
    expect(parsed).toEqual([]);
  });

  it('still keeps a question whose sub_angles are empty (optional, measured)', () => {
    const parsed = parseQuestions(JSON.stringify({
      questions: [validQuestion({ sub_angles: [] })],
    }));
    expect(parsed).toHaveLength(1);
    expect(parsed[0].sub_angles).toEqual([]);
  });
});
