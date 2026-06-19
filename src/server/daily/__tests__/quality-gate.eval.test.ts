// Live quality-gate evals — these call the REAL Haiku gate, not a mock.
//
// They exercise the GENERIC_AT_TIER rubric's actual judgment (BP-4), so a
// regression in the prompt's tier-gating shows up as a failure here rather
// than as silent quality drift in production. Mirrors the conventions of
// src/lib/llm.grading.eval.test.ts.
//
// OPT-IN: they hit the Anthropic API, cost tokens, and are non-deterministic.
// Run explicitly with:
//
//   RUN_LLM_EVALS=1 ANTHROPIC_API_KEY=sk-... npx vitest run eval.test
//
// (or `npm run test:evals`). Without RUN_LLM_EVALS=1 and a valid key, the
// whole describe block is skipped.

import { describe, expect, it } from 'vitest';
import { getAnthropicClient } from '@/lib/llm';
import { findQualityFailures, type LlmQuestion } from '@/server/daily/generate-questions';

const evalsEnabled = process.env.RUN_LLM_EVALS === '1' && getAnthropicClient() !== null;

const EVAL_TIMEOUT_MS = 30_000;

function q(
  text: string,
  answer: string,
  tier: LlmQuestion['difficulty_estimate'],
  domain: string,
): LlmQuestion {
  return {
    canonical_subcategory: domain,
    broad_category: 'Television',
    question_text: text,
    answer,
    explainer: 'Context for the answer.',
    difficulty_estimate: tier,
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

const ROSTER_GENERIC = "In Gilmore Girls, what is the name of Rory's first boyfriend?";

describe.skipIf(!evalsEnabled)('quality gate GENERIC_AT_TIER (live)', () => {
  it(
    'flags a generic roster question at specialist tier',
    async () => {
      const result = await findQualityFailures([
        q(ROSTER_GENERIC, 'Dean Forester', 'specialist', 'Gilmore Girls'),
      ]);
      expect([...result.toDrop]).toEqual([0]);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag the same question at accessible tier (defect is tier-gated)',
    async () => {
      const result = await findQualityFailures([
        q(ROSTER_GENERIC, 'Dean Forester', 'accessible', 'Gilmore Girls'),
      ]);
      expect(result.toDrop.size).toBe(0);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag a fan-salient specialist question, however plainly phrased',
    async () => {
      const result = await findQualityFailures([
        q(
          "In American Psycho, what color is Paul Allen's business card?",
          'bone',
          'specialist',
          'American Psycho',
        ),
      ]);
      expect(result.toDrop.size).toBe(0);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag an accessible exemplar-style identification question',
    async () => {
      // Mirrors the founding-set register ("What is the title of Beethoven's
      // Third Symphony?") — simple identification is allowed at accessible.
      const result = await findQualityFailures([
        q(
          "What is the title of Beethoven's Third Symphony?",
          'Eroica',
          'accessible',
          'Beethoven Symphonies',
        ),
      ]);
      expect(result.toDrop.size).toBe(0);
    },
    EVAL_TIMEOUT_MS,
  );
});

describe.skipIf(!evalsEnabled)('quality gate FALSE_PREMISE (live)', () => {
  it(
    'flags a buried false-count premise even though it reads cleanly',
    async () => {
      // Bach wrote six works for solo violin and six for solo cello, not three
      // of each. The setup's count is false even though the answer is correct.
      const result = await findQualityFailures([
        q(
          'Bach composed six celebrated works for unaccompanied string instrument — three for solo violin and three for solo cello. What collective title is given to the three works written for solo cello?',
          'Cello Suites',
          'moderate',
          "Bach's Cello Suites",
        ),
      ]);
      expect([...result.toDrop]).toEqual([0]);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag the same fact stated with a true premise',
    async () => {
      const result = await findQualityFailures([
        q(
          'Bach wrote six suites for unaccompanied cello (BWV 1007–1012). What collective title are these works known by?',
          'Cello Suites',
          'moderate',
          "Bach's Cello Suites",
        ),
      ]);
      expect(result.toDrop.size).toBe(0);
    },
    EVAL_TIMEOUT_MS,
  );
});
