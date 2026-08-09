import { beforeAll, describe, expect, it } from 'vitest';
import { getAnthropicClient } from '@/lib/llm';
import type { LlmQuestion } from '@/server/daily/generate-questions';

// generate-questions.ts imports @/server/db, which throws at module load
// without a connection string. The parser under test never touches the DB;
// a dummy URL plus dynamic import (the repo convention) keeps the unit pure.
let parseFactualGateResponse: typeof import('@/server/daily/generate-questions').parseFactualGateResponse;
let findFactualFailures: typeof import('@/server/daily/generate-questions').findFactualFailures;

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  ({ parseFactualGateResponse, findFactualFailures } = await import(
    '@/server/daily/generate-questions'
  ));
});

describe('parseFactualGateResponse', () => {
  it('collects in-range drop indices and their reasons', () => {
    const result = parseFactualGateResponse(
      '{"drop_indices":[1],"reasons":{"1":"Rubyfruit Jungle was written by Rita Mae Brown, not Roberta Achtenberg."}}',
      3,
    );
    expect([...result.toDrop]).toEqual([1]);
    expect(result.reasons[1]).toContain('Rita Mae Brown');
  });

  it('ignores out-of-range, non-integer, and negative indices', () => {
    const result = parseFactualGateResponse('{"drop_indices":[5,-1,1.5,0]}', 3);
    expect([...result.toDrop].sort()).toEqual([0]);
  });

  it('drops reasons whose index was not flagged', () => {
    const result = parseFactualGateResponse(
      '{"drop_indices":[0],"reasons":{"0":"wrong","2":"orphan reason"}}',
      3,
    );
    expect(result.reasons).toEqual({ 0: 'wrong' });
  });

  it('returns an empty result for malformed or non-object output', () => {
    for (const raw of ['not json', '[]', '{}', '{"drop_indices":"nope"}']) {
      const result = parseFactualGateResponse(raw, 3);
      expect(result.toDrop.size).toBe(0);
      expect(result.reasons).toEqual({});
    }
  });

  it('parses a multi-drop response intact (the case the raised max_tokens cap protects)', () => {
    const result = parseFactualGateResponse(
      '{"drop_indices":[0,2,4],"reasons":{"0":"wrong count","2":"wrong attribution","4":"false premise"}}',
      5,
    );
    expect([...result.toDrop].sort()).toEqual([0, 2, 4]);
    expect(result.reasons[0]).toBe('wrong count');
    expect(result.reasons[4]).toBe('false premise');
  });

  it('returns empty when the JSON is truncated mid-structure (why findFactualFailures must fail closed)', () => {
    // A response cut off at max_tokens: the parser alone loses every flagged
    // index. findFactualFailures detects this via stop_reason and fails CLOSED
    // (drops the whole batch) — see factual-gate-failclosed.test.ts.
    const truncated =
      '{"drop_indices":[0,1,2],"reasons":{"0":"Neville received ten points not fifty","1":"the choral finale is the Ninth not the Thi';
    const result = parseFactualGateResponse(truncated, 3);
    expect(result.toDrop.size).toBe(0);
    expect(result.reasons).toEqual({});
  });

  it('truncates very long reason strings', () => {
    const long = 'x'.repeat(500);
    const result = parseFactualGateResponse(
      `{"drop_indices":[0],"reasons":{"0":"${long}"}}`,
      1,
    );
    expect(result.reasons[0].length).toBe(200);
  });
});

// Live factual-gate evals — these call the REAL Haiku gate, not a mock.
//
// OPT-IN: they hit the Anthropic API, cost tokens, and are non-deterministic.
// Run explicitly with:
//
//   RUN_LLM_EVALS=1 ANTHROPIC_API_KEY=sk-... npx vitest run eval.test
//
// (or `npm run test:evals`). Without RUN_LLM_EVALS=1 and a valid key, the whole
// describe block is skipped. Mirrors quality-gate.eval.test.ts.

const evalsEnabled = process.env.RUN_LLM_EVALS === '1' && getAnthropicClient() !== null;

const EVAL_TIMEOUT_MS = 30_000;

function q(text: string, answer: string, domain: string, broad = 'Music'): LlmQuestion {
  return {
    canonical_subcategory: domain,
    broad_category: broad,
    question_text: text,
    answer,
    explainer: 'Context for the answer.',
    difficulty_estimate: 'moderate',
    fact_key: null,
    sub_angles: [],
    question_shape: null,
  };
}

describe.skipIf(!evalsEnabled)('factual gate premise check (live)', () => {
  it(
    'flags a question with a correct answer but a FALSE PREMISE in the setup',
    async () => {
      // Bach wrote SIX works for solo violin and SIX for solo cello, not three
      // of each. The keyed answer ("Cello Suites") is correct; the count is a
      // lie. Pre-fix, the factual gate ignored the premise and waved this in.
      const result = await findFactualFailures([
        q(
          'Bach composed six celebrated works for unaccompanied string instrument — three for solo violin and three for solo cello. What collective title is given to the three works written for solo cello?',
          'Cello Suites',
          "Bach's Cello Suites",
        ),
      ]);
      expect([...result.toDrop]).toEqual([0]);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag the same fact stated with a TRUE premise',
    async () => {
      const result = await findFactualFailures([
        q(
          'Bach wrote six suites for unaccompanied cello (BWV 1007–1012). What collective title are these works known by?',
          'Cello Suites',
          "Bach's Cello Suites",
        ),
      ]);
      expect(result.toDrop.size).toBe(0);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag a question whose answer and premise are both correct',
    async () => {
      const result = await findFactualFailures([
        q("What is the title of Beethoven's Third Symphony?", 'Eroica', 'Beethoven Symphonies'),
      ]);
      expect(result.toDrop.size).toBe(0);
    },
    EVAL_TIMEOUT_MS,
  );
});

// Reported 2026-08-07 (Josh). Distinct from the Bach class above: there the
// setup asserts something false. Here EVERY asserted clause is true — the
// witches do open the play, there is a battle, they do agree to meet again —
// and the break is in the ASK. "In thunder, lightning, or in rain?" is the First
// Witch's question, not a plan; Act 1 Sc 1 settles when ("ere the set of sun"),
// where ("upon the heath") and whom ("there to meet with Macbeth"), and leaves
// the weather hanging. No keyed answer can be correct, so the presupposition
// clause added to the gate prompt must drop it.
describe.skipIf(!evalsEnabled)('factual gate presupposition check (live)', () => {
  it(
    'flags a question that presupposes a decision the source never makes',
    async () => {
      const result = await findFactualFailures([
        q(
          "In Shakespeare's 'Macbeth,' the three witches open the play by agreeing to meet again after a battle. In what kind of weather do they plan to reconvene?",
          'Thunder, lightning, or rain',
          'Macbeth',
          'Literature',
        ),
      ]);
      expect([...result.toDrop]).toEqual([0]);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag the same scene asked on what it actually settles',
    async () => {
      const result = await findFactualFailures([
        q(
          "The three witches open Shakespeare's 'Macbeth' by planning where to meet once the battle is done. Whom do they intend to find there?",
          'Macbeth',
          'Macbeth',
          'Literature',
        ),
      ]);
      expect(result.toDrop.size).toBe(0);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag the open question asked AS an open question',
    async () => {
      const result = await findFactualFailures([
        q(
          "Shakespeare's 'Macbeth' opens with one witch asking when the three will meet again — and naming three possibilities in the same breath. What are they?",
          'Thunder, lightning, or rain',
          'Macbeth',
          'Literature',
        ),
      ]);
      expect(result.toDrop.size).toBe(0);
    },
    EVAL_TIMEOUT_MS,
  );
});
