// R3 + R6 + R9 (2026-09-11) — the prompt batch from
// audits/2026-09-11-Fable-QUESTION-DRIFT-PIPELINE-01.md.
//
// These pin the two things a hand-read found the exemplar list and the
// generation prompt were failing to model:
//
//  - Shape coverage. The catalogue offers nine shapes; the curated list
//    demonstrated six, and the three it skipped (what_happens_next,
//    sequence_or_order, a meaningful year_or_date) had produced ONE live row
//    each across 2,191. A shape the model is offered but never shown is a shape
//    it does not write, so the list must keep demonstrating all of them.
//  - The prompt's own examples leaking into output as facts. ~86 live rows
//    reproduced a fact used as an illustration, including facts from the BAD
//    examples. The forbidding rule must ship.

import { describe, expect, it } from 'vitest';

import {
  SINGLE_ANSWER_STYLE_EXEMPLAR_BLOCK,
  STYLE_EXEMPLARS,
  STYLE_EXEMPLAR_BLOCK,
  type StyleExemplarShape,
} from '@/server/daily/exemplars';
import { SYSTEM_PROMPT } from '@/server/daily/generate-questions';

// Every shape the generator's catalogue offers. name_multiple is deliberately
// excluded: it is in the type but is filtered out of the generation block
// because the grader has no partly-correct-list rule.
const GENERATED_SHAPES: StyleExemplarShape[] = [
  'identification',
  'year_or_date',
  'in_which_work',
  'who_did_what',
  'sequence_or_order',
  'technique_or_term',
  'what_happens_next',
  'fill_in_blank',
  'complete_the_quote',
];

describe('STYLE_EXEMPLARS shape coverage (R3)', () => {
  it('demonstrates every shape the generation catalogue offers', () => {
    const present = new Set(STYLE_EXEMPLARS.map((e) => e.shape));
    const missing = GENERATED_SHAPES.filter((shape) => !present.has(shape));
    expect(missing).toEqual([]);
  });

  it('keeps at least one exemplar of each shape in the SINGLE_ANSWER block the generator reads', () => {
    // The generator is primed from the single-answer block, not the full list,
    // so coverage in the full list alone would not reach it.
    for (const shape of GENERATED_SHAPES) {
      expect(SINGLE_ANSWER_STYLE_EXEMPLAR_BLOCK).toContain(`[${shape}]`);
    }
  });

  it('does not let identification dominate the list any further', () => {
    // A ratchet, not a target. identification was 24 of 44 (54.5%) before this
    // batch and is 27 of 54 (50.0%) after — the additions diluted it, but only
    // slightly, because the audit's other half of the fix (retiring six
    // encyclopedia-lead identification exemplars) is a taste call left to the
    // product owner. See the RETIREMENT CANDIDATES note in exemplars.ts. If
    // those are actioned this should drop to ~44% and the ceiling can come down
    // with it. Shapes are labelled honestly here; do not re-label an exemplar
    // to move this number.
    const identification = STYLE_EXEMPLARS.filter((e) => e.shape === 'identification').length;
    expect(identification / STYLE_EXEMPLARS.length).toBeLessThanOrEqual(0.55);
  });

  it('still excludes name_multiple from the generation block (grader cannot score lists)', () => {
    expect(STYLE_EXEMPLAR_BLOCK).toContain('[name_multiple]');
    expect(SINGLE_ANSWER_STYLE_EXEMPLAR_BLOCK).not.toContain('[name_multiple]');
  });

  it('carries a short-register exemplar, so fandom questions are not all 30-word setups', () => {
    const shortest = Math.min(...STYLE_EXEMPLARS.map((e) => e.q.split(/\s+/).length));
    expect(shortest).toBeLessThanOrEqual(8);
  });
});

describe('generation prompt — example facts are off limits (R6)', () => {
  it('ships the rule', () => {
    expect(SYSTEM_PROMPT).toContain('THE EXAMPLES IN THESE INSTRUCTIONS ARE NOT A QUESTION BANK');
  });

  it('names the facts that actually leaked into the live bank', () => {
    // Each of these was reproduced by real generated stock despite the existing
    // "do NOT copy" line; they are the evidence the rule exists for.
    for (const subject of [
      "Mrs. Lovett's pie filling",
      'Neville Longbottom',
      'Candace calling her mother',
      "Big Ben's chimes",
      'cantus firmus',
    ]) {
      expect(SYSTEM_PROMPT).toContain(subject);
    }
  });

  it('extends the ban to facts used in the BAD examples', () => {
    expect(SYSTEM_PROMPT).toContain('A fact used to demonstrate a defect is still off limits');
  });
});

describe('generation prompt — discipline domains get a strip test (R9)', () => {
  it('ships Rule 2c', () => {
    expect(SYSTEM_PROMPT).toContain('STRIP-THE-FIELD TEST');
    expect(SYSTEM_PROMPT).toContain('remove the FIELD name instead');
  });

  it('says plainly that a field question may be easy, just not a definition', () => {
    expect(SYSTEM_PROMPT).toContain('does NOT mean field questions must be hard');
  });

  it('no longer describes technique_or_term as define-then-label', () => {
    // The catalogue entry used to read "asks for the technical term for a
    // described concept", which is the glossary recipe itself.
    expect(SYSTEM_PROMPT).not.toContain('asks for the technical term for a described concept');
  });
});
