// Live grading evals — these call the REAL Haiku grader, not a mock.
//
// Unlike llm.grading.test.ts (which mocks @anthropic-ai/sdk and can only verify
// wiring), these tests exercise the model's actual judgment so a real grading
// regression on a known case will fail the suite.
//
// They are OPT-IN: they hit the Anthropic API, cost tokens, and are
// non-deterministic, so they must never run in normal `npm test` / CI. Run them
// explicitly with:
//
//   RUN_LLM_EVALS=1 ANTHROPIC_API_KEY=sk-... npx vitest run src/lib/llm.grading.eval.test.ts
//
// (or `npm run test:evals`). Without RUN_LLM_EVALS=1 and a valid key, the whole
// describe block is skipped.

import { describe, expect, it } from 'vitest'
import { gradeAnswerWithLLM, getAnthropicClient } from '@/lib/llm'

const evalsEnabled = process.env.RUN_LLM_EVALS === '1' && getAnthropicClient() !== null

// 30s: the grader's own timeout is 8s, but a live round-trip plus retries can run
// longer than vitest's 5s default.
const EVAL_TIMEOUT_MS = 30_000

describe.skipIf(!evalsEnabled)('gradeAnswerWithLLM (live grader)', () => {
  // Regression guard for the Hum Aapke Hain Koun..! daughter-in-law case.
  // Pooja — the deceased — IS the daughter-in-law (bahu) of Prem's household, so
  // "the death of the daughter in law" names the right event and the right person,
  // just by family role rather than by name. The first-pass grader marked this
  // wrong in production; per the prompt's "capture the core concept" leniency rule
  // it should be correct. See the LENIENCY RULES in gradeAnswerWithLLM.
  const HAHK_QUESTION =
    'In the blockbuster Bollywood family film Hum Aapke Hain Koun..!, the central ' +
    'romance unfolds between Prem and Nisha, but a family tragedy threatens their ' +
    'union. What tragic event forces the families to reconsider who should marry whom?'
  const HAHK_CANONICAL = "Nisha's sister Pooja dies (after falling from a staircase / in an accident)"

  it.each([
    'The death of the daughter in law',
    'the daughter-in-law dies',
    "Pooja's death",
  ])('marks "%s" correct', async (submitted) => {
    const outcome = await gradeAnswerWithLLM(HAHK_QUESTION, HAHK_CANONICAL, submitted, 'factual')
    expect(outcome.result).toBe('correct')
  }, EVAL_TIMEOUT_MS)
})
