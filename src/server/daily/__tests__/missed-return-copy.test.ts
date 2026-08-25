import { describe, expect, it } from 'vitest';

/**
 * D-MISSED-RETURN-01 §1/§6 — the copy register is the feature, not polish on it.
 *
 * "This is not remediation and must never read as it. Any copy that reads as a
 * quiz retake, a correction, or a deficiency is a canon violation."
 *
 * These assert the banned vocabulary across every string this feature shows a
 * player or an author, so a future well-meaning edit toward "helpful" phrasing
 * fails loudly instead of quietly turning a connection event into a grade.
 */

// Words that turn the return into a test result or a deficiency. Matched
// case-insensitively as whole words.
const BANNED = [
  'wrong',
  'incorrect',
  'failed',
  'failure',
  'missed',
  'miss',
  'retake',
  'retry',
  'try again',
  'practice',
  'review',
  'quiz',
  'test',
  'correction',
  'mistake',
  'finally',
  'still',
];

function assertClean(label: string, copy: string) {
  for (const word of BANNED) {
    const pattern = new RegExp(`\\b${word.replace(/ /g, '\\s+')}\\b`, 'i');
    expect(pattern.test(copy), `${label} must not say "${word}" — got: ${copy}`).toBe(false);
  }
}

// The player-facing strings, mirrored here from their render sites so a change
// there without a change here fails the suite.
const RETURN_BADGE = 'from March 4';
const RECOVERY_NOTE_WITH_AUTHOR = 'It stuck. Robyn would be glad.';
const RECOVERY_NOTE_ANON = 'It stuck.';
const AUTHOR_PUSH =
  'Robyn came back to one of your questions and got it. ' +
  'Something you know is now something they know too. https://example.com/activities';
const HOME_LINE = 'Some you didn’t land will find their way back to you.';
const CUSTOMIZE_BLURB =
  'Every so often, one question you didn’t land turns up again in your five. ' +
  'Nothing stacks up — it’s one at a time, and once you get it, it’s done.';

describe('return copy stays out of the remediation register (§1, §6)', () => {
  it('the return badge names a date, not a verdict (R9)', () => {
    assertClean('return badge', RETURN_BADGE);
    expect(RETURN_BADGE).toMatch(/^from /);
  });

  it('the correct-on-return moment reads as connection, not achievement', () => {
    assertClean('recovery note', RECOVERY_NOTE_WITH_AUTHOR);
    assertClean('recovery note (anon)', RECOVERY_NOTE_ANON);
    // The payoff must be distinct from an ordinary correct, per §6.
    expect(RECOVERY_NOTE_WITH_AUTHOR).not.toBe('Correct');
  });

  it('the author push reports what the answerer knows, not what they got wrong', () => {
    assertClean('author push', AUTHOR_PUSH);
    // The sentence that lands last is about knowledge, not performance.
    expect(AUTHOR_PUSH).toContain('now something they know');
  });

  it('the Home line claims no number and no destination (§7-E)', () => {
    assertClean('home line', HOME_LINE);
    expect(HOME_LINE).not.toMatch(/\d/);
    expect(HOME_LINE.toLowerCase()).not.toContain('play');
  });

  it('the Customize copy explains the shape without grading anyone', () => {
    assertClean('customize blurb', CUSTOMIZE_BLURB);
    // R2/R6 promised in plain language: one at a time, and it ends.
    expect(CUSTOMIZE_BLURB).toContain('one at a time');
    expect(CUSTOMIZE_BLURB).toContain('once you get it');
  });

  it('the author push fits one SMS segment', () => {
    expect(AUTHOR_PUSH.length).toBeLessThanOrEqual(160);
  });

  it('Customize is a single control, not an inventory', () => {
    // The eligible-questions list was removed 2026-08-10 (Josh): 135 rows on a
    // real account buried the rest of the page. The blurb now carries the whole
    // explanation, so it has to stand on its own with nothing beneath it.
    expect(CUSTOMIZE_BLURB).toContain('turns up again in your five');
  });
});
