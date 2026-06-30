import { beforeAll, describe, expect, it } from 'vitest';

import { getAnthropicClient } from '@/lib/llm';

// verify-question.ts → @/lib/llm → @/server/db, which throws at load without a
// connection string. The pure functions never touch the DB; a dummy URL plus
// dynamic import (repo convention, see factual-gate.test.ts) keeps the unit pure.
let mod: typeof import('@/server/quality/verify-question');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/server/quality/verify-question');
});

describe('parseVerifyVerdict', () => {
  it('parses each valid verdict', () => {
    expect(mod.parseVerifyVerdict('{"verdict":"ok","reason":"verified"}')?.outcome).toBe('ok');
    expect(mod.parseVerifyVerdict('{"verdict":"demoted","reason":"Chip is book-1 only"}')?.outcome).toBe('demoted');
    expect(mod.parseVerifyVerdict('{"verdict":"unverifiable","reason":"no source"}')?.outcome).toBe('unverifiable');
  });

  it('keeps the reason and truncates it', () => {
    const long = 'x'.repeat(500);
    const r = mod.parseVerifyVerdict(`{"verdict":"demoted","reason":"${long}"}`);
    expect(r?.reason.length).toBe(200);
  });

  it('returns null for an unknown verdict or malformed JSON', () => {
    expect(mod.parseVerifyVerdict('{"verdict":"maybe"}')).toBeNull();
    expect(mod.parseVerifyVerdict('not json')).toBeNull();
    expect(mod.parseVerifyVerdict('{}')).toBeNull();
  });
});

describe('verdictToQuestionPatch — demote-only, always stamps', () => {
  const now = new Date('2026-06-30T00:00:00Z');

  it('demote sets publicStatus needs_review (never touches answerText)', () => {
    const patch = mod.verdictToQuestionPatch('demoted', now);
    expect(patch.publicStatus).toBe('needs_review');
    expect(patch.verificationVerdict).toBe('demoted');
    expect(patch.verifiedAt).toBe(now);
    expect('answerText' in patch).toBe(false);
  });

  it('ok / unverifiable / skipped stamp but never demote', () => {
    for (const v of ['ok', 'unverifiable', 'skipped'] as const) {
      const patch = mod.verdictToQuestionPatch(v, now);
      expect(patch.publicStatus).toBeUndefined();
      expect(patch.verificationVerdict).toBe(v);
      expect(patch.verifiedAt).toBe(now);
    }
  });
});

describe('verdictToGeneratedPatch — demote suppresses via is_duplicate', () => {
  const now = new Date('2026-06-30T00:00:00Z');

  it('demote sets is_duplicate = true', () => {
    const patch = mod.verdictToGeneratedPatch('demoted', now);
    expect(patch.isDuplicate).toBe(true);
    expect(patch.verificationVerdict).toBe('demoted');
    expect(patch.verifiedAt).toBe(now);
  });

  it('ok / unverifiable / skipped stamp but never suppress', () => {
    for (const v of ['ok', 'unverifiable', 'skipped'] as const) {
      const patch = mod.verdictToGeneratedPatch(v, now);
      expect(patch.isDuplicate).toBeUndefined();
      expect(patch.verificationVerdict).toBe(v);
      expect(patch.verifiedAt).toBe(now);
    }
  });
});

// Live eval — the real proof that the WEB-GROUNDED verifier catches what
// prompt-posture and Opus alone could not. OPT-IN (hits the API + web search,
// costs tokens, non-deterministic). Run with:
//   RUN_LLM_EVALS=1 VERIFY_WEB_SEARCH_ENABLED=true ANTHROPIC_API_KEY=sk-... npx vitest run verify-question
const evalsEnabled = process.env.RUN_LLM_EVALS === '1' && getAnthropicClient() !== null;
const EVAL_TIMEOUT_MS = 60_000;

describe.skipIf(!evalsEnabled)('verifyQuestion — web-grounded (live)', () => {
  it(
    'demotes the reported Spy School false-premise question',
    async () => {
      const result = await mod.verifyQuestion({
        questionText:
          "In the Spy School series, one of the recurring antagonists is a student who repeatedly proves to be a thorn in Ben's side — not because he's a skilled spy, but because he's a bully and a schemer within the academy itself. What is this student's name?",
        answer: 'Chip Schacter',
        explanation: null,
        canonicalSubcategory: 'Spy School Books 1-6',
        broadCategory: 'Literature',
        dimensions: ['false_premise'],
      });
      expect(result?.outcome).toBe('demoted');
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'leaves a clean mainstream question alone',
    async () => {
      const result = await mod.verifyQuestion({
        questionText: "What is the title of Beethoven's Third Symphony?",
        answer: 'Eroica',
        explanation: null,
        canonicalSubcategory: 'Beethoven Symphonies',
        broadCategory: 'Music',
        dimensions: ['false_premise'],
      });
      expect(result?.outcome).toBe('ok');
    },
    EVAL_TIMEOUT_MS,
  );
});
