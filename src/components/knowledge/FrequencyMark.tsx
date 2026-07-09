// The rotation-frequency signal mark (B-FREQUENCY-MARK-01). One reusable SVG
// glyph for the four rotation-frequency states, rendered alongside the existing
// text label wherever the four `TERRITORY_FREQUENCY_LABEL` strings appear.
//
// Vocabulary (ratified):
//   often     → three ascending signal bars rising from a baseline rule.
//   sometimes → the baseline rule + the first two (shortest) bars.
//   blue_moon → a small blue crescent (a distinct glyph, NOT "one bar"). Its
//               blue is a fixed cross-category token, never category-tinted.
//   resting   → no mark at all. Absence is the signal ("Never" = null).
//
// The bars inherit the domain's category color via the `color` prop (a CSS var
// like `var(--cat-literature)`), falling back to `--brand-ink-400`. The label
// always carries the meaning — the mark is decorative next to its own text, and
// only self-labels (role="img" + <title>) when a caller renders it label-less.
// Pure presentational: it reads no preferences and writes nothing.

import type { ReactElement } from 'react';

import {
  TERRITORY_FREQUENCY_LABEL,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model';

export function FrequencyMark({
  frequency,
  color = 'var(--brand-ink-400)',
  size = 14,
  className,
  decorative = false,
}: {
  frequency: TerritoryFrequency;
  /** Resolved category color for the bars, e.g. 'var(--cat-literature)'.
   *  Ignored for blue_moon (fixed blue) and resting (renders nothing).
   *  Defaults to 'var(--brand-ink-400)' when omitted. */
  color?: string;
  size?: number;
  className?: string;
  /** When true, the mark sits next to its own text label → aria-hidden, no
   *  <title>. When false (default), it self-labels for SR users. */
  decorative?: boolean;
}): ReactElement | null {
  // `resting` ("Never") renders nothing — absence is the signal. No wrapper, no
  // spacer, so a resting row degrades cleanly to label-only.
  if (frequency === 'resting') return null;

  // Never render below ~11px effective; the bars/crescent lose legibility.
  const px = Math.max(12, size);

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

  // Signal bars (often / sometimes) — strokes only, flat, no fills or gradients.
  // Uniform stroke width scales with size (≈1px at size 14).
  const strokeWidth = px / 14;
  // Bar x-slots and tops from the ratified prototype (viewBox 0 0 14 10). Bar 1
  // is shortest, bar 3 tallest — the signal-strength slant. `sometimes` drops
  // the tallest bar, keeping the baseline + first two shortest bars.
  const bars = [
    { x: 4.3, top: 6 },
    { x: 7.1, top: 3.5 },
    { x: 9.9, top: 1 },
  ];
  const shown = frequency === 'often' ? bars : bars.slice(0, 2);

  return (
    <svg
      width={px}
      height={(px * 10) / 14}
      viewBox="0 0 14 10"
      fill="none"
      className={className}
      style={{ display: 'block', flexShrink: 0 }}
      {...a11y}
    >
      {title}
      <line
        x1={1.5}
        y1={9}
        x2={12.5}
        y2={9}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
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
