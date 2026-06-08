'use client';

// The "From Your Friends" triangle event indicators. Four inline-SVG marks (no
// raster), each drawn from the JOSHING triangle palette and normalized to an
// EXACT 24px width so every activity row's text starts at the same x. The marks
// are centered on the first text line and decorative (aria-hidden) — the row
// copy always explains the event. Shared by Home ("What's Happening") and
// Lately / `/activities`.
//
// Shape vocabulary (Figma JOSHING-DESIGN-SYSTEM2 is the source for shape):
//   bundle   → 2–2–1 cluster      a friend's questions for you (milestone).
//                                 Unanswered = filled, answered = hollow outline.
//   diamond  → rhombus             someone answered ("got") a question.
//   hourglass→ two triangles apex-to-apex   someone sends you a question.
//   domain   → half-triangles split on a diagonal   a new domain opened.
//
// COLOR: each individual triangle's fill is picked at random from the triangle
// palette — but deterministically, hashed from a stable seed (the row id + the
// triangle's position) so the colors are identical on the server and the client
// (no hydration flicker) and never reshuffle on re-render. Answered cluster
// triangles ignore the palette and render as a hollow outline.

import type { StreamIconKind } from '@/lib/activity-stream';

// The triangle palette (globals.css). Solid fills are picked from these; the
// hollow outline of a spent triangle uses the muted ink token.
const PALETTE = [
  'var(--tri-orange)', // #d15e36
  'var(--tri-darkteal)', // #6d837f — teal
  'var(--tri-lightteal)', // #adb19e — sage
  'var(--tri-cream)', // #f8e6c7
  'var(--tri-darkyellow)', // #deae5c
  'var(--tri-lighttan)', // #edd2a3
];
// Per design: triangle fills render at 80% opacity (softens the saturated
// orange/teal so the feed stays calm).
const FILL_OPACITY = 0.8;
const HOLLOW = 'var(--brand-ink-400)'; // #8a8a8a — outline of a spent triangle

// EVERY mark sits in this fixed-width column, so the left edge of the text never
// shifts between rows. The TOP of each mark aligns to the top of the first text
// line; taller marks extend downward past it.
const MARK_W = 24;
const GAP = 8;
const LINE_H = 22.5; // first text line: 15px × 1.5
// The stacked single-shape marks (diamond / hourglass / domain) are a vertical
// pair of triangles. Full base=height triangles would make the pair 24×48 — too
// tall, and the two halves end up far apart vertically (they read as two
// disconnected shapes). We draw each half intentionally shorter than base=height
// so the pair is 24×STACK_H and the halves sit close together. The cluster
// (BundleMark, made of small triangles) keeps full base=height. Rendered at 70%,
// centered horizontally in the 24px column.
const LARGE_SCALE = 0.7;
// Height of each half of a stacked mark, and the total viewBox height of the
// pair. Shorter than the 24px base on purpose — see LARGE_SCALE note above.
const STACK_HALF = 18;
const STACK_H = STACK_HALF * 2; // 36

export type ActivityIconSpec =
  | { kind: 'bundle'; total: number; unanswered: number }
  | { kind: 'diamond' }
  | { kind: 'hourglass' }
  | { kind: 'domain' };

// Map the serializable StreamIconKind to a concrete render spec. The bundle's
// live counts are supplied by the row (they tick as the viewer answers); the
// other marks are stateless.
export function specForIcon(
  icon: StreamIconKind,
  bundle: { total: number; unanswered: number } | null,
): ActivityIconSpec | null {
  switch (icon) {
    case 'bundle':
      return bundle && bundle.total > 0 ? { kind: 'bundle', ...bundle } : null;
    case 'diamond':
      return { kind: 'diamond' };
    case 'hourglass':
      return { kind: 'hourglass' };
    case 'domain':
      return { kind: 'domain' };
    default:
      return null;
  }
}

// Stable 32-bit hash (FNV-1a). Pure and platform-independent, so the palette
// pick is identical across SSR and hydration — unlike Math.random().
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// Deterministic palette colour for the triangle at position `i` within `seed`.
function colorFor(seed: string, i: number): string {
  return PALETTE[hash(`${seed}:${i}`) % PALETTE.length];
}

// One upward triangle filling its bounding box [x, y, w, h].
function upTri(x: number, y: number, w: number, h: number): string {
  return `M${x},${y + h} L${x + w / 2},${y} L${x + w},${y + h} Z`;
}

// A hollow (spent) triangle is stroked, and a centered stroke bulges ~half its
// width OUTSIDE the path — making it read larger than a flat-filled triangle.
// Shrink the outline about the triangle's centroid by HOLLOW_INSET so its outer
// stroke edge lands on the same footprint as the filled triangles.
const HOLLOW_INSET = 0.84;
function hollowTri(x: number, y: number, w: number, h: number): string {
  const cx = x + w / 2;
  const cy = y + (2 * h) / 3; // centroid of an upward triangle
  const k = HOLLOW_INSET;
  const pts: Array<[number, number]> = [
    [x, y + h],
    [x + w / 2, y],
    [x + w, y + h],
  ];
  const [a, b, c] = pts.map(([px, py]) => [cx + k * (px - cx), cy + k * (py - cy)]);
  return `M${a[0]},${a[1]} L${b[0]},${b[1]} L${c[0]},${c[1]} Z`;
}

// A svg whose viewBox is always 24 wide; rendered at MARK_W × scale (aspect
// preserved from the viewBox height).
function MarkSvg({
  h,
  scale = 1,
  children,
}: {
  h: number;
  scale?: number;
  children: React.ReactNode;
}) {
  const w = MARK_W * scale;
  return (
    <svg width={w} height={(h / 24) * w} viewBox={`0 0 24 ${h}`} fill="none">
      {children}
    </svg>
  );
}

// 2–2–1 cluster (top-down: 1, 2, 2), spanning the full 24px width. Renders
// exactly `total` triangles (1–5); the first `unanswered` are solid (random
// palette colour per position), the rest hollow (spent/played).
function BundleMark({
  total,
  unanswered,
  seed,
}: {
  total: number;
  unanswered: number;
  seed: string;
}) {
  const B = 11; // triangle base
  const TH = 11; // triangle height — isosceles, base = height (not smushed)
  // Positions in viewBox order: top, mid-left, mid-right, bottom-left, bottom-right.
  const pos: Array<[number, number]> = [
    [6.5, 0],
    [0, 11],
    [13, 11],
    [0, 22],
    [13, 22],
  ];
  return (
    <MarkSvg h={33}>
      {pos.slice(0, total).map(([x, y], i) => {
        const solid = i < unanswered;
        return (
          <path
            key={i}
            d={solid ? upTri(x, y, B, TH) : hollowTri(x, y, B, TH)}
            fill={solid ? colorFor(seed, i) : 'none'}
            fillOpacity={solid ? FILL_OPACITY : undefined}
            stroke={solid ? 'none' : HOLLOW}
            strokeWidth={solid ? 0 : 1.4}
            strokeLinejoin="round"
          />
        );
      })}
    </MarkSvg>
  );
}

// Rhombus: upward triangle over downward triangle, shared base. Each half a
// random palette colour.
function DiamondMark({ seed }: { seed: string }) {
  return (
    <MarkSvg h={STACK_H} scale={LARGE_SCALE}>
      <path
        d={`M12,0 L0,${STACK_HALF} L24,${STACK_HALF} Z`}
        fill={colorFor(seed, 0)}
        fillOpacity={FILL_OPACITY}
      />
      <path
        d={`M0,${STACK_HALF} L24,${STACK_HALF} L12,${STACK_H} Z`}
        fill={colorFor(seed, 1)}
        fillOpacity={FILL_OPACITY}
      />
    </MarkSvg>
  );
}

// Two triangles meeting apex-to-apex at the center, tips touching. A question
// sent your way.
function HourglassMark({ seed }: { seed: string }) {
  return (
    <MarkSvg h={STACK_H} scale={LARGE_SCALE}>
      <path
        d={`M0,0 L24,0 L12,${STACK_HALF} Z`}
        fill={colorFor(seed, 0)}
        fillOpacity={FILL_OPACITY}
      />
      <path
        d={`M12,${STACK_HALF} L0,${STACK_H} L24,${STACK_H} Z`}
        fill={colorFor(seed, 1)}
        fillOpacity={FILL_OPACITY}
      />
    </MarkSvg>
  );
}

// The hourglass split apart on a diagonal: a half top-right and a half
// bottom-left. Divergence = a new domain opened. The two halves are pulled in
// toward the centerline (each shifted 6 units off the viewBox edge instead of
// sitting flush against it) so the diagonal gap between them reads tighter —
// they still split on the same diagonal and stay rotationally symmetric.
function DomainMark({ seed }: { seed: string }) {
  return (
    <MarkSvg h={STACK_H} scale={LARGE_SCALE}>
      <path
        d={`M18,0 L6,0 L18,${STACK_HALF} Z`}
        fill={colorFor(seed, 0)}
        fillOpacity={FILL_OPACITY}
      />
      <path
        d={`M6,${STACK_HALF} L18,${STACK_H} L6,${STACK_H} Z`}
        fill={colorFor(seed, 1)}
        fillOpacity={FILL_OPACITY}
      />
    </MarkSvg>
  );
}

function Mark({ spec, seed }: { spec: ActivityIconSpec; seed: string }) {
  switch (spec.kind) {
    case 'bundle':
      return <BundleMark total={spec.total} unanswered={spec.unanswered} seed={seed} />;
    case 'diamond':
      return <DiamondMark seed={seed} />;
    case 'hourglass':
      return <HourglassMark seed={seed} />;
    case 'domain':
      return <DomainMark seed={seed} />;
  }
}

// The fixed icon column: exactly MARK_W wide (+ GAP) for EVERY row, even iconless
// ones, so text alignment never shifts. The mark centers on the first text line.
// `seed` (the row id) makes the per-triangle palette pick stable and per-row.
export function ActivityIcon({ spec, seed }: { spec: ActivityIconSpec | null; seed: string }) {
  return (
    <div
      aria-hidden
      style={{
        width: MARK_W,
        marginRight: GAP,
        height: LINE_H,
        // Nudge down by the line's half-leading so the mark's top meets the
        // glyph cap height (the top of "R"), not the line-box top above it.
        paddingTop: 7,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        overflow: 'visible',
      }}
    >
      {spec ? <Mark spec={spec} seed={seed} /> : null}
    </div>
  );
}
