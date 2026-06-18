'use client'

import type {
  CommonGround as CommonGroundData,
  CommonGroundDomain,
} from '@/server/db/queries/common-ground'

import {
  circleDatasetMax,
  DomainCircleSvg,
  FRIEND_FILL,
  VIEWER_FILL,
} from './common-ground-circles'

type CommonGroundProps = {
  // Null when the section isn't applicable (e.g. owner self-view); renders nothing.
  data: CommonGroundData | null
  friendFirstName: string
  // Cap on the total number of domains rendered across both groups (proven
  // first, then latent fills the remainder). Undefined renders everything.
  limit?: number
}

export function CommonGround({ data, friendFirstName, limit }: CommonGroundProps) {
  if (!data) return null

  const { proven, latent, isEmpty } = data

  // Apply the optional display cap, spending the budget on proven domains
  // first so the strongest overlap always survives the trim.
  const provenShown = typeof limit === 'number' ? proven.slice(0, limit) : proven
  const latentBudget =
    typeof limit === 'number' ? Math.max(0, limit - provenShown.length) : undefined
  const latentShown =
    latentBudget === undefined ? latent : latent.slice(0, latentBudget)

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

  const datasetMax = circleDatasetMax(
    [...provenShown, ...latentShown].flatMap((d) => [
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
          {provenShown.length > 0 ? (
            <DomainGroup
              caption="Proven together"
              domains={provenShown}
              datasetMax={datasetMax}
              ghosted={false}
              friendFirstName={friendFirstName}
            />
          ) : null}

          {latentShown.length > 0 ? (
            <DomainGroup
              caption="Shared, still untested"
              domains={latentShown}
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
  const label =
    domain.kind === 'proven'
      ? `You and ${friendFirstName} both know ${domain.canonical_subcategory}`
      : `${domain.canonical_subcategory}: shared but not yet proven`

  return (
    <div className="flex max-w-[160px] min-w-[110px] flex-col items-center gap-1.5 px-1">
      <DomainCircleSvg
        viewerPoints={domain.viewer.mastery_points}
        friendPoints={domain.friend.mastery_points}
        viewerTier={domain.viewer.current_tier}
        friendTier={domain.friend.current_tier}
        datasetMax={datasetMax}
        ariaLabel={label}
      />
      <p
        className="text-center font-serif text-sm leading-tight"
        style={{ color: 'var(--brand-ink)' }}
      >
        {domain.canonical_subcategory}
      </p>
    </div>
  )
}
