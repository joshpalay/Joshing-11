// Live domain-drift (OFF_DOMAIN) evals — these call the REAL Haiku quality
// gate, not a mock. Mirrors the conventions of quality-gate.eval.test.ts.
//
// diagnosis/answer-leak-domain-drift-plan.md Phase 2: DOMAIN_DRIFT_DROP_ENABLED
// stays off until this file passes BOTH bars — every known positive caught,
// and every containment negative left alone. A single containment false
// positive (a correctly-filed question silently demoted forever) is the
// failure mode this gate can never let through, and it is otherwise
// invisible in production — nothing would ever surface it as wrong.
//
// Fixtures are the REAL rows from the 2026-09-05 incident and its corpus scan
// (see the PR #1611 description and the diagnosis doc), not invented cases.
//
// OPT-IN: hits the Anthropic API, costs tokens, non-deterministic. Run with:
//
//   RUN_LLM_EVALS=1 ANTHROPIC_API_KEY=sk-... npx vitest run domain-drift.eval
//
// (or `npm run test:evals`). Without RUN_LLM_EVALS=1 and a valid key, the
// whole describe block is skipped — this environment has no local API key,
// so these fixtures are prepared but UNRUN as of 2026-09-06. Whoever runs
// them should log the outcome in the diagnosis doc's Updates section.

import { describe, expect, it } from 'vitest';
import { getAnthropicClient } from '@/lib/llm';
import { findQualityFailures, type LlmQuestion } from '@/server/daily/generate-questions';

const evalsEnabled = process.env.RUN_LLM_EVALS === '1' && getAnthropicClient() !== null;

const EVAL_TIMEOUT_MS = 30_000;

function q(domain: string, factKey: string, text: string, answer = 'answer'): LlmQuestion {
  return {
    canonical_subcategory: domain,
    broad_category: 'Literature',
    question_text: text,
    answer,
    explainer: 'Context for the answer.',
    difficulty_estimate: 'moderate',
    fact_key: factKey,
    sub_angles: [],
    question_shape: null,
  };
}

const WOOLF = "Virginia Woolf's Novels and Essays";
const ORCHESTRAL = 'Romantic Era Orchestral Music';

// --- Positives: real drifted rows served in prod (should be flagged) -------

const JOYCE_UNDER_WOOLF = q(
  WOOLF,
  'james-joyce-irish-modernism-portrait-of-the-artist-as-a-young-man-a-petition-cal',
  "In Joyce's 'A Portrait of the Artist as a Young Man,' Stephen Dedalus famously refuses to sign a petition for universal peace circulated among students at University College Dublin. What cause did that petition support?",
);

const FORSTER_UNDER_WOOLF = q(
  WOOLF,
  'early-20c-british-modernist-howards-end-epigraph-only-connect',
  "In E.M. Forster's 'Howards End,' the novel's moral vision is compressed into a two-word imperative that appears as the book's epigraph. What are those two words?",
  'Only connect',
);

const OPERA_UNDER_ORCHESTRAL = q(
  'Romantic Opera',
  'donizetti-elisir-damore-dulcamara-elixir-bordeaux',
  "In Donizetti's 'L'elisir d'amore,' the quack doctor Dulcamara sells the lovesick Nemorino a bottle of cheap Bordeaux wine, claiming it is what?",
  "A love elixir (L'elisir d'amore)",
);

// --- Negatives: correctly-filed containment (must NOT be flagged) ----------

const MRS_DALLOWAY_UNDER_WOOLF = q(
  WOOLF,
  'mrs-dalloway-big-ben-chimes-time-unifying-device',
  "In 'Mrs. Dalloway,' Woolf uses a specific recurring sound — the chiming of a London clock — heard by multiple characters across the city throughout the day. What clock is it?",
  'Big Ben',
);

const SESAME_STREET_UNDER_CHILDRENS_TV = q(
  "Classic Children's Television",
  'sesame-street-big-bird-imaginary-friend-snuffleupagus',
  'On Sesame Street, what is the name of Big Bird\'s shy, imaginary friend who looks like a giant woolly mammoth?',
  'Mr. Snuffleupagus',
);

const BREAKING_BAD_UNDER_COLOR_REFERENCES = q(
  'Color References Across Film and TV',
  'breaking-bad-walter-white-wardrobe-color-transformation',
  "In Breaking Bad, Walter White's transformation into a ruthless drug lord is tracked partly through his wardrobe, which shifts from muted earth tones toward what color as he embraces the Heisenberg persona?",
  'Black',
);

const NEW_TESTAMENT_BOOK_UNDER_NEW_TESTAMENT = q(
  'New Testament',
  'nt-matthew-magi-gifts-gold-frankincense-myrrh',
  'In the Gospel of Matthew, wise men from the East follow a star to find the newborn Jesus. What three gifts do they present to him?',
  'Gold, frankincense, and myrrh',
);

describe.skipIf(!evalsEnabled)('quality gate OFF_DOMAIN (live)', () => {
  it(
    'flags a Joyce question filed under Virginia Woolf (the 2026-09-05 incident row)',
    async () => {
      const result = await findQualityFailures([JOYCE_UNDER_WOOLF]);
      expect(result.offDomain.has(0)).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'flags an E.M. Forster question filed under Virginia Woolf',
    async () => {
      const result = await findQualityFailures([FORSTER_UNDER_WOOLF]);
      expect(result.offDomain.has(0)).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'flags a Romantic Opera question filed under Romantic Era Orchestral Music',
    async () => {
      const result = await findQualityFailures([OPERA_UNDER_ORCHESTRAL]);
      expect(result.offDomain.has(0)).toBe(true);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag Mrs. Dalloway under Virginia Woolf — containment, not drift',
    async () => {
      const result = await findQualityFailures([MRS_DALLOWAY_UNDER_WOOLF]);
      expect(result.offDomain.has(0)).toBe(false);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag Sesame Street under Classic Children\'s Television',
    async () => {
      const result = await findQualityFailures([SESAME_STREET_UNDER_CHILDRENS_TV]);
      expect(result.offDomain.has(0)).toBe(false);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag Breaking Bad under Color References Across Film and TV',
    async () => {
      const result = await findQualityFailures([BREAKING_BAD_UNDER_COLOR_REFERENCES]);
      expect(result.offDomain.has(0)).toBe(false);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'does NOT flag a New Testament book question under New Testament',
    async () => {
      const result = await findQualityFailures([NEW_TESTAMENT_BOOK_UNDER_NEW_TESTAMENT]);
      expect(result.offDomain.has(0)).toBe(false);
    },
    EVAL_TIMEOUT_MS,
  );

  it(
    'mixed batch: flags the drifted rows and spares the contained ones in the same call',
    async () => {
      const batch = [
        JOYCE_UNDER_WOOLF,
        MRS_DALLOWAY_UNDER_WOOLF,
        OPERA_UNDER_ORCHESTRAL,
        SESAME_STREET_UNDER_CHILDRENS_TV,
      ];
      const result = await findQualityFailures(batch);
      expect(result.offDomain.has(0)).toBe(true); // Joyce
      expect(result.offDomain.has(1)).toBe(false); // Mrs. Dalloway
      expect(result.offDomain.has(2)).toBe(true); // Romantic Opera
      expect(result.offDomain.has(3)).toBe(false); // Sesame Street
    },
    EVAL_TIMEOUT_MS,
  );
});
