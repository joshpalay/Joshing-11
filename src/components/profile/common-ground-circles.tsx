import type { MasteryTier } from '@/types/db'

// Shared geometry + rendering for the "Common ground" overlapping-circles motif.
// Ported from OverlapMap (CategoryItem): diameter scales with a user's mastery
// points in the domain; the gap between the two circles encodes overlap strength
// (derived here from tier closeness). Used both by the profile-page CommonGround
// section and by the homepage "What's happening" common-ground promo, so the
// (clip-safe) bounding-box math lives in ONE place — see circleGeometry.
export const MIN_DIAMETER = 20
export const MAX_DIAMETER = 56

// Viewer = brand navy, friend = brand orange — the app's two signature accents
// (--brand-navy / --brand-orange) form a calm, on-brand two-tone split so each
// circle reads as "you" vs the friend at a glance against the cream surface.
export const VIEWER_FILL = '#1f3a5a' // --brand-navy
export const FRIEND_FILL = '#d15e36' // --brand-orange
export const CIRCLE_OPACITY = 0.72

const TIER_INDEX: Record<MasteryTier, number> = {
  establishing: 0,
  familiar: 1,
  solid: 2,
  mastery: 3,
}

function overlapRatioFromTiers(a: MasteryTier, b: MasteryTier): number {
  return 1 - Math.abs(TIER_INDEX[a] - TIER_INDEX[b]) / 3
}

// Scale circle diameters against the largest mastery score across everything we
// render, so the biggest circle is always MAX_DIAMETER. Floored at 1 to avoid
// divide-by-zero when every point value is zero.
export function circleDatasetMax(points: number[]): number {
  return Math.max(1, ...points)
}

// The pure geometry, shared so the clip fix lives in one place. The viewer
// circle (centered at rA) spans [0, 2*rA]; the friend circle (centered at
// rA + gap) spans [rA + gap - rB, rA + gap + rB]. Either edge can fall outside
// the naive [0, 2*rA] box: when the viewer is larger with a small gap its RIGHT
// edge overflows, and when the friend is larger (e.g. Wagner's Ring Cycle) with
// a small gap its LEFT edge goes negative. We size the viewport to the union of
// both circles and shift everything right by -minX so neither circle is clipped
// by the viewBox origin.
function circleGeometry(
  viewerPoints: number,
  friendPoints: number,
  viewerTier: MasteryTier,
  friendTier: MasteryTier,
  datasetMax: number,
) {
  const dA = MIN_DIAMETER + (viewerPoints / datasetMax) * (MAX_DIAMETER - MIN_DIAMETER)
  const dB = MIN_DIAMETER + (friendPoints / datasetMax) * (MAX_DIAMETER - MIN_DIAMETER)
  const rA = dA / 2
  const rB = dB / 2
  const overlapRatio = overlapRatioFromTiers(viewerTier, friendTier)
  const gap = (rA + rB) * (1 - overlapRatio * 0.85)
  const minX = Math.min(0, rA + gap - rB)
  const maxX = Math.max(2 * rA, rA + gap + rB)
  const offsetX = -minX
  const svgWidth = maxX - minX
  const svgHeight = Math.max(dA, dB)
  const cy = svgHeight / 2
  return { svgWidth, svgHeight, cy, rA, rB, gap, offsetX }
}

// The two overlapping circles alone (no label, no wrapper) so callers can frame
// them however the surface needs.
export function DomainCircleSvg({
  viewerPoints,
  friendPoints,
  viewerTier,
  friendTier,
  datasetMax,
  ariaLabel,
  scale = 1,
}: {
  viewerPoints: number
  friendPoints: number
  viewerTier: MasteryTier
  friendTier: MasteryTier
  datasetMax: number
  ariaLabel: string
  // Renders the motif larger (or smaller) without touching the geometry: the
  // viewBox is unchanged, only the rendered width/height scale. The editorial
  // "Shared Ground" feature uses this to make the circles the hero artwork.
  scale?: number
}) {
  const { svgWidth, svgHeight, cy, rA, rB, gap, offsetX } = circleGeometry(
    viewerPoints,
    friendPoints,
    viewerTier,
    friendTier,
    datasetMax,
  )
  return (
    <svg
      width={svgWidth * scale}
      height={svgHeight * scale}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      role="img"
      aria-label={ariaLabel}
    >
      {/* fill via style (not the SVG attribute) to keep parity with OverlapMap */}
      <circle
        cx={rA + offsetX}
        cy={cy}
        r={rA}
        style={{ fill: VIEWER_FILL }}
        opacity={CIRCLE_OPACITY}
      />
      <circle
        cx={rA + gap + offsetX}
        cy={cy}
        r={rB}
        style={{ fill: FRIEND_FILL }}
        opacity={CIRCLE_OPACITY}
      />
    </svg>
  )
}
