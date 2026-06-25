import { type CSSProperties } from 'react'

import { formatRelativeTime } from '@/components/feed/visual'
import type { RecentlyExploringDomain } from '@/server/profile/recently-exploring'

type RecentlyExploringSectionProps = {
  domains: RecentlyExploringDomain[]
  friendFirstName: string
}

// Rotating accent palette for the row initial badges. Mirrors the visual
// treatment of the Knowledge page's "Recently Expanding" card
// (src/components/knowledge/RecentlyExpanding.tsx) so the two surfaces read
// as the same component family.
const ROW_ACCENTS = [
  { border: 'var(--exploring-accent-red)', fill: 'color-mix(in srgb, var(--exploring-accent-red) 16%, transparent)' },
  { border: 'var(--exploring-accent-gold)', fill: 'color-mix(in srgb, var(--exploring-accent-gold) 14%, transparent)' },
  { border: 'var(--exploring-accent-red)', fill: 'color-mix(in srgb, var(--exploring-accent-red) 16%, transparent)' },
  { border: 'var(--exploring-accent-blue)', fill: 'color-mix(in srgb, var(--exploring-accent-blue) 20%, transparent)' },
  { border: 'var(--exploring-accent-gold)', fill: 'color-mix(in srgb, var(--exploring-accent-gold) 14%, transparent)' },
]

/**
 * "Recently exploring" presence section on a friend's profile. Shows which
 * domains the friend has been answering in lately, derived from `masteryEvents`
 * recency. Distinct from the historical knowledge map (sorted by points) and
 * from declared shared interests. Renders nothing when there is no recent
 * activity (the page also guards on a non-empty list).
 *
 * Styled to match the Knowledge page's "Recently Expanding" card: a cream card
 * box with a circular initial badge, serif domain names, and border-separated
 * rows. The supporting line keeps this surface's real data — a relative
 * timestamp — rather than the reason strings the knowledge version derives.
 */
export function RecentlyExploringSection({
  domains,
  friendFirstName,
}: RecentlyExploringSectionProps) {
  if (domains.length === 0) return null

  return (
    <section className="mt-5" aria-label="Recently exploring">
      <div style={boxStyle}>
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
            Recently exploring
          </p>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            What {friendFirstName}’s been answering lately.
          </p>
        </div>
        <div style={rowsStyle}>
          {domains.map((domain, index) => {
            const accent = ROW_ACCENTS[index % ROW_ACCENTS.length]
            return (
              <div key={domain.domain} style={rowStyle} data-exploring-row="true">
                <div
                  style={{
                    ...badgeStyle,
                    borderColor: accent.border,
                    background: accent.fill,
                  }}
                  aria-hidden="true"
                >
                  {getDomainInitial(domain.displayName)}
                </div>
                <div style={rowTextStyle}>
                  <h3 style={domainNameStyle}>{domain.displayName}</h3>
                  <p style={supportingStyle}>
                    {formatRelativeTime(domain.lastActivityAt)}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}

function getDomainInitial(domain: string): string {
  const firstMeaningfulWord = domain
    .replace(/&/g, ' ')
    .split(/\s+/)
    .find((word) => /^[a-z0-9]/i.test(word))
  return (firstMeaningfulWord?.[0] ?? domain[0] ?? '?').toUpperCase()
}

const boxStyle: CSSProperties = {
  background: 'var(--brand-cream-card)',
  border: '1px solid var(--brand-border)',
  borderRadius: 12,
  boxShadow: 'var(--shadow-card)',
  padding: '1.05rem 0.95rem 0.65rem',
  display: 'grid',
  gap: '0.75rem',
}

const rowsStyle: CSSProperties = {
  display: 'grid',
}

const rowStyle: CSSProperties = {
  minHeight: 62,
  display: 'grid',
  gridTemplateColumns: '44px minmax(0, 1fr)',
  alignItems: 'center',
  columnGap: '0.75rem',
  padding: '0.54rem 0',
  borderTop: '1px solid var(--border-light)',
}

const badgeStyle: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 999,
  border: '1px solid',
  color: 'var(--warm-ink)',
  display: 'grid',
  placeItems: 'center',
  fontSize: '0.86rem',
  fontWeight: 700,
  lineHeight: 1,
}

const rowTextStyle: CSSProperties = {
  minWidth: 0,
}

const domainNameStyle: CSSProperties = {
  margin: 0,
  color: 'var(--warm-ink)',
  fontFamily: 'var(--font-serif), Georgia, serif',
  fontSize: '0.92rem',
  fontWeight: 700,
  lineHeight: 1.18,
  overflowWrap: 'anywhere',
}

const supportingStyle: CSSProperties = {
  margin: '0.18rem 0 0',
  color: 'var(--warm-ink-700)',
  fontSize: '0.68rem',
  lineHeight: 1.25,
}
