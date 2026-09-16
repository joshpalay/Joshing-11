import { describe, expect, it } from 'vitest';

import { findBankSameFactDuplicates, type LlmQuestion } from '@/server/daily/generate-questions';

// B-DEDUP-BANK-SAME-FACT-01. Fixtures are the real 2026-09-16 Mrs. Dalloway
// audit: six freshly generated questions, five already servable in the bank
// under different fact_keys and stems that embedded below every threshold.

const q = (over: Partial<LlmQuestion>): LlmQuestion => ({
  canonical_subcategory: 'Mrs. Dalloway',
  broad_category: 'Literature',
  question_text: 'stem',
  answer: 'answer',
  explainer: 'explainer',
  difficulty_estimate: 'moderate',
  fact_key: 'k',
  subject_entity: 'Clarissa Dalloway',
  sub_angles: [],
  question_shape: 'identification',
  ...over,
});

const bank = [
  { domainKey: 'mrs. dalloway', subjectEntity: 'Clarissa Dalloway', answer: 'Cymbeline' },
  { domainKey: 'mrs. dalloway', subjectEntity: 'Mrs. Dalloway (novel)', answer: 'Mrs. Dalloway said she would buy the flowers herself' },
  { domainKey: 'mrs. dalloway', subjectEntity: 'Peter Walsh', answer: 'A penknife (pocket knife)' },
  { domainKey: 'mrs. dalloway', subjectEntity: 'Sir William Bradshaw', answer: 'Proportion' },
  { domainKey: 'mrs. dalloway', subjectEntity: 'Elizabeth Dalloway', answer: 'an omnibus' },
  { domainKey: 'hamlet', subjectEntity: 'Polonius', answer: 'two' },
];

describe('findBankSameFactDuplicates', () => {
  it('catches the audit collisions and passes the genuinely new question', () => {
    const batch = [
      q({ answer: 'Cymbeline' }),
      q({ answer: 'A penknife', subject_entity: 'Peter Walsh' }),
      q({ answer: 'Proportion', subject_entity: 'Sir William Bradshaw' }),
      q({ answer: 'an omnibus', subject_entity: 'Elizabeth Dalloway' }),
      q({ answer: 'Hugh Whitbread', subject_entity: 'Lady Bruton' }),
    ];
    expect([...findBankSameFactDuplicates(batch, bank)].sort()).toEqual([0, 1, 2, 3]);
  });

  it('matches on subject+answer across domain labels (the Woolf-domain drift case)', () => {
    const batch = [q({ canonical_subcategory: "Virginia Woolf's Novels and Essays", subject_entity: 'Peter Walsh', answer: 'penknife' })];
    expect(findBankSameFactDuplicates(batch, bank).size).toBe(1);
  });

  it('does not match the same answer in an unrelated domain with a different subject', () => {
    const batch = [q({ canonical_subcategory: 'Shakespeare', subject_entity: 'Imogen', answer: 'Cymbeline' })];
    expect(findBankSameFactDuplicates(batch, bank).size).toBe(0);
  });

  it('never matches on a low-information answer', () => {
    const batch = [q({ canonical_subcategory: 'Hamlet', subject_entity: 'Polonius', answer: 'Two' })];
    expect(findBankSameFactDuplicates(batch, bank).size).toBe(0);
  });
});
