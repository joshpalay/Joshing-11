'use client'

import type {
  CommonGround as CommonGroundData,
  CommonGroundDomain,
} from '@/server/db/queries/common-ground'
import type { MasteryTier } from '@/types/db'

type CommonGroundProps = {
  // Null when the section isn't applicable (e.g. owner self-view); renders nothing.
  data: CommonGroundData | null
  friendFirstName: string
}

// Circle geometry is ported from src/components/OverlapMap.tsx (CategoryItem).
// Diameter scales with a user's mastery points in the domain; the gap between
// the two circles encodes overlap strength. Unlike OverlapMap (whose overlap
// ratio comes from shared correct answers), here overlap is derived from tier
// closeness, per the profile-page spec.
const MIN_DIAMETER = 20
const MAX_DIAMETER = 56

// Viewer = sky, friend = rose — a calm two-tone split so each circle reads as
// "you" vs the friend at a glance.
const VIEWER_FILL = '#38bdf8' // sky-400
const FRIEND_FILL = '#fb7185' // rose-400
const CIRCLE_OPACITY = 0.72

const TIER_INDEX: Record<MasteryTier, number> = {
  establishing: 0,
  familiar: 1,
  solid: 2,
  mastery: 3,
}

function overlapRatioFromTiers(a: MasteryTier, b: MasteryTier): number {
  return 1 - Math.abs(TIER_INDEX[a] - TIER_INDEX[b]) / 3
}

export function CommonGround({ data, friendFirstName }: CommonGroundProps) {
  if (!data) return null

  const { proven, latent, isEmpty } = data

  let headline: string
  if (proven.length === 1) {
    headline = `You and ${friendFirstName} both know ${proven[0].canonical_subcategory}.`
  } else if (proven.length > 1) {
    headline = `Common ground with ${friendFirstName}.`
  } else if (latent.length > 0) {
    headline = `Shared ground with ${friendFirstName}, still untested.`
  } else {
    headline = `No overlap with ${friendFirstName} yet.`
  }

  // Scale circle diameters against the largest mastery score across everything
  // we render, so the biggest circle is always MAX_DIAMETER. Floored at 1 to
  // avoid divide-by-zero when every domain is latent at zero points.
  const datasetMax = Math.max(
    1,
    ...[...proven, ...latent].flatMap((d) => [
      d.viewer.mastery_points,
      d.friend.mastery_points,
    ]),
  )

  return (
    <section className="mt-5" aria-label="Common ground">
      <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
        Common ground
      </p>
      <h2 className="mt-1 font-serif text-2xl font-semibold">{headline}</h2>

      {isEmpty ? null : (
        <>
          {proven.length > 0 ? (
            <DomainGroup
              caption="Proven together"
              domains={proven}
              datasetMax={datasetMax}
              ghosted={false}
              friendFirstName={friendFirstName}
            />
          ) : null}

          {latent.length > 0 ? (
            <DomainGroup
              caption="Shared, still untested"
              domains={latent}
              datasetMax={datasetMax}
              ghosted
              friendFirstName={friendFirstName}
            />
          ) : null}

          <div
            className="mt-5 flex flex-wrap items-center gap-4 border-t pt-3 text-[10px] font-semibold tracking-[0.16em] uppercase"
            style={{ borderColor: 'var(--warm-border)' }}
          >
            <span
              className="inline-flex items-center gap-2"
              style={{ color: VIEWER_FILL }}
            >
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-full"
                style={{ background: VIEWER_FILL }}
              />
              You
            </span>
            <span
              className="inline-flex items-center gap-2"
              style={{ color: FRIEND_FILL }}
            >
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-full"
                style={{ background: FRIEND_FILL }}
              />
              {friendFirstName}
            </span>
          </div>
        </>
      )}
    </section>
  )
}

function DomainGroup({
  caption,
  domains,
  datasetMax,
  ghosted,
  friendFirstName,
}: {
  caption: string
  domains: CommonGroundDomain[]
  datasetMax: number
  ghosted: boolean
  friendFirstName: string
}) {
  return (
    <div className={`mt-5 ${ghosted ? 'opacity-60' : ''}`}>
      <p
        className="text-[11px] font-semibold tracking-[0.12em] uppercase"
        style={{ color: 'var(--brand-ink-700)' }}
      >
        {caption}
      </p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-4">
        {domains.map((domain) => (
          <DomainCircles
            key={domain.canonical_subcategory}
            domain={domain}
            datasetMax={datasetMax}
            friendFirstName={friendFirstName}
          />
        ))}
      </div>
      {ghosted ? (
        <p
          className="mt-3 font-serif text-sm italic"
          style={{ color: 'var(--brand-ink-700)' }}
        >
          {domains.length === 1
            ? `You both claim ${domains[0].canonical_subcategory} — neither's been tested yet.`
            : `Domains you both claim but neither of you has been tested on yet.`}
        </p>
      ) : null}
    </div>
  )
}

function DomainCircles({
  domain,
  datasetMax,
  friendFirstName,
}: {
  domain: CommonGroundDomain
  datasetMax: number
  friendFirstName: string
}) {
  const dA =
    MIN_DIAMETER +
    (domain.viewer.mastery_points / datasetMax) * (MAX_DIAMETER - MIN_DIAMETER)
  const dB =
    MIN_DIAMETER +
    (domain.friend.mastery_points / datasetMax) * (MAX_DIAMETER - MIN_DIAMETER)
  const rA = dA / 2
  const rB = dB / 2
  const overlapRatio = overlapRatioFromTiers(
    domain.viewer.current_tier,
    domain.friend.current_tier,
  )
  const gap = (rA + rB) * (1 - overlapRatio * 0.85)
  const svgWidth = rA + gap + rB
  const svgHeight = Math.max(dA, dB)
  const cy = svgHeight / 2

  const label =
    domain.kind === 'proven'
      ? `You and ${friendFirstName} both know ${domain.canonical_subcategory}`
      : `${domain.canonical_subcategory}: shared but not yet proven`

  return (
    <div className="flex max-w-[160px] min-w-[110px] flex-col items-center gap-1.5 px-1">
      <svg
        width={svgWidth}
        height={svgHeight}
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        role="img"
        aria-label={label}
      >
        {/* fill via style (not the SVG attribute) to keep parity with OverlapMap */}
        <circle
          cx={rA}
          cy={cy}
          r={rA}
          style={{ fill: VIEWER_FILL }}
          opacity={CIRCLE_OPACITY}
        />
        <circle
          cx={rA + gap}
          cy={cy}
          r={rB}
          style={{ fill: FRIEND_FILL }}
          opacity={CIRCLE_OPACITY}
        />
      </svg>
      <p
        className="text-center font-serif text-sm leading-tight"
        style={{ color: 'var(--brand-ink)' }}
      >
        {domain.canonical_subcategory}
      </p>
    </div>
  )
}
