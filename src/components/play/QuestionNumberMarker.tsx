import type { CSSProperties } from 'react';

/**
 * QuestionNumberMarker (B-GAMEPLAY-QUESTION-NUMBER-BOX-01)
 *
 * A large editorial number marker that sits in the gutter ABOVE each gameplay
 * question card. Replaces the old per-bubble sub-eyebrow number string.
 *
 *  - Core questions (1–5): the numeral followed by a period — `1.` … `5.` —
 *    in Cormorant Garamond, reversed out of a solid `--ink` rounded box.
 *  - Bonus questions: `BONUS` over `n of N` — its OWN sequence, never the core
 *    denominator. `6`/`7` remains forbidden: the five stays five
 *    (B-BONUS-QUESTION-STANDARDIZE-01). Amended 2026-09-06 from the original
 *    `✦` glyph, which told the player a bonus existed but not how many were
 *    left; the count is the whole point of the change.
 *  - Return questions (additive, not bonus): still `✦`. A returning question
 *    isn't a bonus and has no sequence of its own to count.
 *
 * Design intent (DECISIONS.md: D-GAMEPLAY-NUMBER-BOX-PLACEMENT / -STATELESS /
 * D-GAMEPLAY-BONUS-GLYPH):
 *  - Solid `--ink` fill carves the numeral out of the dense triangle-pattern
 *    background. This is a LEGIBILITY decision, not a status-color one.
 *  - The box is POSITIONAL only. It never encodes result state (correct/wrong) —
 *    that is the dot track's job — and it persists unchanged after the question
 *    is answered (F2).
 *  - Near-color-agnostic: every box keeps the solid `--ink` / `--primary-
 *    foreground` pairing. The bonus box adds the same 4px `--accent-gold` inset
 *    rail the bonus CARD already ships, so the two read as kin. Colour
 *    REINFORCES here, it never carries: the word `BONUS` and the count do that,
 *    so canon R3 ("never by color") holds — a monochrome or colour-blind reader
 *    loses nothing. Still no category or result colour; the box remains
 *    positional and never encodes correct/wrong.
 *
 * The category label is NOT part of this marker — it stays inside the card as
 * its own independent element.
 */

// x-large per the resolved size fork. The box height drives every other
// dimension (radius, width, font size) so the marker scales as one unit.
const BOX_HEIGHT = 76;
// Rounded rect: border-radius ≈ 0.22 × height.
const BOX_RADIUS = Math.round(BOX_HEIGHT * 0.22);
// Core box is slightly wider than tall (~1.12×) to hold the trailing period;
// the bonus box is square.
const CORE_BOX_WIDTH = Math.round(BOX_HEIGHT * 1.12);
// Cormorant Garamond, weight 600. Core numeral ~46px; bonus glyph ~42px.
const CORE_FONT_SIZE = 46;
const BONUS_FONT_SIZE = 42;
// The counted bonus box carries two stacked lines, so it needs more width than
// the square glyph box and smaller type than the core numeral.
const BONUS_BOX_WIDTH = Math.round(BOX_HEIGHT * 1.55);
const BONUS_COUNT_SIZE = 26;
const BONUS_EYEBROW_SIZE = 10;
// The bonus CARD's actual signature is a gold INSET RAIL over a normal ground
// (GameplayChat: `inset 4px 0 0 var(--accent-gold)`), not a tinted fill. The
// marker mirrors that exactly: same --ink fill as core, same 4px gold rail, so
// the box reads as kin to the card it labels. A tinted fill was tried first and
// rejected — mixing gold into near-black navy lands on a muddy olive-slate
// rather than anything recognisably gold.
const BONUS_BOX_RAIL = `var(--shadow-overlay), inset 4px 0 0 var(--accent-gold)`;
// Optical nudge: pad the numeral left ~12% of the font size so the trailing
// period doesn't visually shove the numeral off-center.
const CORE_LEFT_PAD = Math.round(CORE_FONT_SIZE * 0.12);
// Vertical optical nudge. Cormorant Garamond carries an unusually tall ascent
// metric (~1.49em, reserving room for accents) and a deep descent (~0.43em), so
// with line-height 1 the baseline lands near the BOTTOM of the line box
// (half-leading ≈ -0.46em ⇒ baseline ≈ 1.03em from the top). A lining figure
// sits between baseline and cap-height (~0.65em), so its visible ink centers at
// ~0.70em — about 0.2em below the line-box center — and the trailing period adds
// a touch more ink at the baseline. The numeral therefore reads LOW. Lift the
// glyph ~16% of the em to bring its optical center back to the box center. (The
// earlier -0.08em corrected under half of this, which is why it still read low.)
// In em so it scales with the font size; applied to the inner glyph span only
// (the box and its accessible label are unaffected).
const NUMERAL_NUDGE_Y = '-0.16em';

const boxBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  height: BOX_HEIGHT,
  borderRadius: BOX_RADIUS,
  // Fill: --ink. Numeral/glyph: --primary-foreground (the reversed "paper"
  // cream this codebase already pairs with navy ink — see UserRow). No other
  // tokens; color-agnostic by design.
  background: 'var(--ink)',
  color: 'var(--primary-foreground)',
  // Drop shadow so the box lifts off the dense triangle pattern. Uses the
  // existing --shadow-overlay token (the heaviest elevation register — modals/
  // overlays) rather than a one-off rgba: no new color is introduced, and it is
  // the strongest lift available from the established tokens.
  boxShadow: 'var(--shadow-overlay)',
  fontFamily: 'var(--font-serif)',
  fontWeight: 600,
  lineHeight: 1,
  userSelect: 'none',
};

export function QuestionNumberMarker({
  value,
  bonus = false,
  bonusIndex,
  bonusTotal,
}: {
  /** 1-based core question number (1–5). Ignored when `bonus` is true. */
  value: number;
  /** Additive slot: renders the bonus box, or `✦` with no count available. */
  bonus?: boolean;
  /** 1-based position within the bonus run — the `n` in "n of N". */
  bonusIndex?: number;
  /** How many bonus slots this round carries — the `N` in "n of N". */
  bonusTotal?: number;
}) {
  if (bonus) {
    // A return slot (additive but not a +2) has no sequence of its own, so it
    // keeps the original glyph. Same fallback if a count is ever unavailable.
    const hasCount =
      typeof bonusIndex === 'number' &&
      typeof bonusTotal === 'number' &&
      bonusIndex > 0 &&
      bonusTotal > 0;

    if (!hasCount) {
      return (
        <span
          role="img"
          aria-label="Bonus question"
          style={{ ...boxBaseStyle, width: BOX_HEIGHT, fontSize: BONUS_FONT_SIZE }}
        >
          <span aria-hidden>✦</span>
        </span>
      );
    }

    return (
      <span
        role="img"
        aria-label={`Bonus question ${bonusIndex} of ${bonusTotal}`}
        style={{
          ...boxBaseStyle,
          width: BONUS_BOX_WIDTH,
          boxShadow: BONUS_BOX_RAIL,
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <span
          aria-hidden
          style={{
            fontFamily: 'var(--font-sans)',
            fontSize: BONUS_EYEBROW_SIZE,
            fontWeight: 700,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            opacity: 0.85,
          }}
        >
          Bonus
        </span>
        <span aria-hidden style={{ fontSize: BONUS_COUNT_SIZE }}>
          {bonusIndex} of {bonusTotal}
        </span>
      </span>
    );
  }

  return (
    <span
      role="img"
      aria-label={`Question ${value}`}
      style={{
        ...boxBaseStyle,
        width: CORE_BOX_WIDTH,
        fontSize: CORE_FONT_SIZE,
        paddingLeft: CORE_LEFT_PAD,
      }}
    >
      <span aria-hidden style={{ transform: `translateY(${NUMERAL_NUDGE_Y})` }}>
        {value}.
      </span>
    </span>
  );
}
