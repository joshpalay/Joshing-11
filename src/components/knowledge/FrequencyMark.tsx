// The rotation-frequency signal mark (B-FREQUENCY-MARK-01 / D-FREQUENCY-MARK-01).
// One reusable SVG glyph for the four rotation-frequency states, rendered to the
// RIGHT of the existing text label wherever the four `TERRITORY_FREQUENCY_LABEL`
// strings appear.
//
// Vocabulary (ratified):
//   often     → baseline rule + three ascending signal bars (short→tall).
//   sometimes → baseline rule + the first two (shortest) bars.
//   resting   → the baseline rule ALONE (no bars), washed to 0.28 stroke-opacity
//               — "no signal" in the same visual family, mirroring the washed
//               Never *circle* (coreOpacity = 0.28). Never is not absent and not
//               neutral-gray; it is the faint floor of the category-tinted set.
//   blue_moon → a small blue crescent (a distinct glyph, NOT "one bar"). Its blue
//               is a fixed cross-category token, never category-tinted.
//
// The bars AND the Never line inherit the domain's category color via the `color`
// prop (a CSS var like `var(--cat-literature)`), falling back to `--brand-ink-400`
// on category-less surfaces. The label always carries the meaning — the mark is
// decorative next to its own text, and only self-labels (role="img" + <title>)
// when a caller renders it label-less. Pure presentational: no preference reads.

import type { ReactElement } from 'react';

import {
  TERRITORY_FREQUENCY_LABEL,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model';

export function FrequencyMark({
  frequency,
  color = 'var(--brand-ink-400)',
  size = 14,
  decorative = false,
  className,
}: {
  frequency: TerritoryFrequency;
  /** Resolved category color for the bars + the Never line, e.g.
   *  'var(--cat-literature)'. Ignored for blue_moon (fixed blue).
   *  Defaults to 'var(--brand-ink-400)' for category-less surfaces. */
  color?: string;
  size?: number;
  /** When true, an adjacent text label already carries the meaning (the common
   *  case) → aria-hidden, no <title>. When false, self-labels for SR users. */
  decorative?: boolean;
  className?: string;
}): ReactElement {
  // Never render below ~11px effective; the bars/crescent lose legibility.
  const px = Math.max(11, size);

  // Decorative marks (the common case, beside their own label) are aria-hidden;
  // label-less marks self-describe via role="img" + <title>.
  const a11y = decorative
    ? ({ 'aria-hidden': true } as const)
    : ({ role: 'img' } as const);
  const title = decorative ? null : <title>{TERRITORY_FREQUENCY_LABEL[frequency]}</title>;

  if (frequency === 'blue_moon') {
    // Self-contained crescent — fixed blue, never category-tinted.
    return (
      <svg
        width={px}
        height={px}
        viewBox="0 0 14 14"
        fill="none"
        className={className}
        style={{ display: 'block', flexShrink: 0 }}
        {...a11y}
      >
        {title}
        <path d="M9.5 2.2a5 5 0 1 0 2.3 6.8A5.6 5.6 0 0 1 9.5 2.2Z" fill="var(--freq-blue-moon)" />
      </svg>
    );
  }

  // The signal mark (often / sometimes / resting) shares one viewBox so all three
  // align in a row. viewBox is 14 wide × 10 tall; height maps to `size`, so the
  // rendered mark is `size` tall and `round(size * 14/10)` wide. Strokes only —
  // flat, no fills or gradients.
  const strokeWidth = px / 14;
  const width = Math.round((px * 14) / 10);
  // Bar x-slots and tops from the ratified prototype. Bar 1 is shortest, bar 3
  // tallest — the signal-strength slant. `sometimes` keeps the two shortest;
  // `resting` shows the baseline rule alone (washed), no bars.
  const bars = [
    { x: 4.3, top: 6 },
    { x: 7.1, top: 3.5 },
    { x: 9.9, top: 1 },
  ];
  const shown =
    frequency === 'often' ? bars : frequency === 'sometimes' ? bars.slice(0, 2) : [];
  const resting = frequency === 'resting';

  return (
    <svg
      width={width}
      height={px}
      viewBox="0 0 14 10"
      fill="none"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
      {...a11y}
    >
      {title}
      {/* Baseline rule. For `resting` it is the whole mark, washed to 0.28 —
          the faint floor of the same category-tinted family as the raised bars. */}
      <line
        x1={1.5}
        y1={9}
        x2={12.5}
        y2={9}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeOpacity={resting ? 0.28 : undefined}
      />
      {shown.map((bar) => (
        <line
          key={bar.x}
          x1={bar.x}
          y1={9}
          x2={bar.x}
          y2={bar.top}
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
      ))}
    </svg>
  );
}
