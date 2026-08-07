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

  it('keeps the reason and truncates it at 500 (200 cut verdicts mid-word)', () => {
    const long = 'x'.repeat(700);
    const r = mod.parseVerifyVerdict(`{"verdict":"demoted","reason":"${long}"}`);
    expect(r?.reason.length).toBe(500);
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

  it('stamps the verifier reason when provided, omits it when absent/blank (0100)', () => {
    expect(mod.verdictToQuestionPatch('demoted', now, 'Belial, not Moloch').verificationReason).toBe(
      'Belial, not Moloch',
    );
    expect('verificationReason' in mod.verdictToQuestionPatch('demoted', now)).toBe(false);
    expect('verificationReason' in mod.verdictToQuestionPatch('skipped', now, '  ')).toBe(false);
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

  it('stamps the verifier reason when provided (0100)', () => {
    expect(mod.verdictToGeneratedPatch('demoted', now, 'wrong adjacent fact').verificationReason).toBe(
      'wrong adjacent fact',
    );
    expect('verificationReason' in mod.verdictToGeneratedPatch('demoted', now)).toBe(false);
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

  // Reported 2026-07-15 (Josh): the verifier stamped this 'ok' because it
  // confirmed the PREMISE (the book is ABOUT a White House mission) and read that
  // as confirming the PROPORTION the question actually asks ("bulk of the action"
  // — in fact only the first 3-4 chapters). The proportion clause added to
  // false_premise must now settle it as unverifiable (sources describe the hook,
  // not scene distribution) or demoted — anything but a false 'ok'.
  it(
    'does not falsely OK the Spy School "bulk of the action" proportion overstatement',
    async () => {
      const result = await mod.verifyQuestion({
        questionText:
          "In Spy School Secret Service, Ben's mission takes him to a location that is both the most famous address in America and a genuinely dangerous operational environment. Where does the bulk of the action in that book take place?",
        answer: 'The White House',
        explanation:
          'Spy School Secret Service places Ben inside the White House as part of a mission involving the Secret Service detail.',
        canonicalSubcategory: 'Spy School Books 1-6',
        broadCategory: 'Literature',
        dimensions: ['false_premise'],
      });
      expect(result?.outcome).not.toBe('ok');
    },
    EVAL_TIMEOUT_MS,
  );

  // Reported 2026-07-15 (Josh): the clue misattributes the AGENT — Yunobo's Vow
  // launches YUNOBO as the flaming boulder, not Link. The answer ("Yunobo's Vow")
  // is correct, so only the false_premise agent-attribution check can catch it.
  it(
    'catches the Tears of the Kingdom agent-misattribution (Yunobo, not Link, becomes the sphere)',
    async () => {
      const result = await mod.verifyQuestion({
        questionText:
          "In Tears of the Kingdom, the sages who aid Link each bestow a power tied to their element. The Goron sage's ability lets Link roll into enemies as a flaming sphere. What is this sage power called?",
        answer: "Yunobo's Vow / Vow of Yunobo",
        explanation: null,
        canonicalSubcategory: 'The Legend of Zelda Tears of the Kingdom',
        broadCategory: 'Gaming',
        dimensions: ['false_premise'],
      });
      expect(result?.outcome).not.toBe('ok');
    },
    EVAL_TIMEOUT_MS,
  );

  // Reported 2026-08-07 (Josh): every asserted clause here is TRUE — the witches
  // do open the play, there is a battle, they do agree to meet again — so the
  // setup-assertion posture that catches Bach/Spy School has nothing to bite on.
  // The break is the INTERROGATIVE's presupposition: "In thunder, lightning, or
  // in rain?" is the First Witch's opening QUESTION, and Act 1 Sc 1 settles when,
  // where and whom while leaving the weather unresolved. Must demote, not 'ok' —
  // and specifically NOT 'unverifiable': the source is perfectly clear, and what
  // it is clear about is that no such plan exists.
  it(
    'demotes a question presupposing a decision the source never makes (Macbeth weather)',
    async () => {
      const result = await mod.verifyQuestion({
        questionText:
          "In Shakespeare's 'Macbeth,' the three witches open the play by agreeing to meet again after a battle. In what kind of weather do they plan to reconvene?",
        answer: 'Thunder, lightning, or rain',
        explanation: null,
        canonicalSubcategory: 'Macbeth',
        broadCategory: 'Literature',
        dimensions: ['false_premise'],
      });
      expect(result?.outcome).toBe('demoted');
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'leaves the same Macbeth scene alone when asked on what it actually settles',
    async () => {
      const result = await mod.verifyQuestion({
        questionText:
          "The three witches open Shakespeare's 'Macbeth' by planning where to meet once the battle is done. Whom do they intend to find there?",
        answer: 'Macbeth',
        explanation: null,
        canonicalSubcategory: 'Macbeth',
        broadCategory: 'Literature',
        dimensions: ['false_premise'],
      });
      expect(result?.outcome).toBe('ok');
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
