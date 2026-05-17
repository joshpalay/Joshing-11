'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { Share2 } from 'lucide-react'
import type { MasteryTier } from '@/types/db'
import { DomainCircle } from '@/components/knowledge/DomainCircle'
import { buildKnowledgeCardPublicUrl } from '@/lib/knowledge-card'

export interface KnowledgeDomainCircle {
  canonicalSubcategory: string
  canonicalSubcategorySlug: string
  currentTier: MasteryTier
  lifetimePoints: number
  iconKey: string
  broadCategory?: string | null
}

export interface KnowledgeCardProps {
  playerDisplayName: string
  portraitStatement: string
  domains: KnowledgeDomainCircle[]
  overflowCount: number
  tierSignature: string
  rarestTerritory: string | null
  rarestTerritorySolo: boolean
  shareText: string
  shareCardToken: string
  shareCardExpiresAt: string
  readOnly?: boolean
  highlightedSlug?: string | null
  onShareClick?: () => void
}

function getCircleDiameter(
  points: number,
  maxPoints: number,
  isMobile: boolean
): number {
  const max = isMobile ? 64 : 80
  const min = isMobile ? 24 : 28
  const ratio = maxPoints > 0 ? points / maxPoints : 0
  return Math.round(min + ratio * (max - min))
}

export function KnowledgeCard(props: KnowledgeCardProps) {
  const [shareLabel, setShareLabel] = useState('Share')
  const sorted = useMemo(
    () =>
      [...props.domains].sort((a, b) => b.lifetimePoints - a.lifetimePoints),
    [props.domains]
  )
  const visibleDomains = sorted.slice(0, 5)
  const totalOverflowCount =
    props.overflowCount + Math.max(0, sorted.length - visibleDomains.length)
  const maxPoints = sorted[0]?.lifetimePoints ?? 1
  const isMobileViewport =
    typeof window !== 'undefined' ? window.innerWidth < 400 : false
  const visibleDomainDiameters = visibleDomains.map((domain) =>
    getCircleDiameter(domain.lifetimePoints, maxPoints, isMobileViewport)
  )
  const circleSlotSize = Math.max(...visibleDomainDiameters, 0)

  const onShare = async () => {
    if (props.onShareClick) {
      props.onShareClick()
      return
    }
    const url = buildKnowledgeCardPublicUrl(props.shareCardToken)
    if (navigator.share) {
      await navigator.share({ text: props.shareText, url })
      return
    }
    await navigator.clipboard.writeText(url)
    setShareLabel('Link copied')
    window.setTimeout(() => setShareLabel('Share'), 2000)
  }

  return (
    <section style={boxStyle} aria-label="Your Knowledge Portrait">
      <div style={headerStyle}>
        <p style={wordmarkStyle}>Joshing</p>
        <button
          type="button"
          style={shareButtonStyle}
          onClick={onShare}
          data-portrait-share="true"
          aria-label="Share your knowledge portrait"
        >
          <Share2 size={15} strokeWidth={1.8} aria-hidden="true" />
          <span>{shareLabel}</span>
        </button>
      </div>
      <h2 style={titleStyle}>Your Knowledge Portrait</h2>

      <p style={statementStyle}>{props.portraitStatement}</p>

      <div style={circlesWrapStyle}>
        {visibleDomains.map((domain, index) => {
          const diameter =
            visibleDomainDiameters[index] ??
            getCircleDiameter(
              domain.lifetimePoints,
              maxPoints,
              isMobileViewport
            )
          return (
            <DomainCircle
              key={domain.canonicalSubcategorySlug}
              id={`knowledge-portrait-circle-${domain.canonicalSubcategorySlug}`}
              diameter={diameter}
              iconKey={domain.iconKey}
              canonicalSubcategory={domain.canonicalSubcategory}
              broadCategory={domain.broadCategory}
              currentTier={domain.currentTier}
              highlighted={
                props.highlightedSlug === domain.canonicalSubcategorySlug
              }
              circleSlotSize={circleSlotSize}
            />
          )
        })}
      </div>
      {totalOverflowCount > 0 && (
        <p style={overflowStyle}>+{totalOverflowCount} more territories</p>
      )}

      <p style={tierStyle}>{props.tierSignature}</p>
      {props.rarestTerritory && (
        <p style={rarestStyle}>
          Rarest territory: {props.rarestTerritory}
          {props.rarestTerritorySolo ? " — you're the only one here" : ''}
        </p>
      )}
      <p style={attributionStyle}>{props.playerDisplayName} on Joshing</p>
    </section>
  )
}

const boxStyle: CSSProperties = {
  background: '#fffdf8',
  border: '1px solid #eee7dc',
  borderRadius: 14,
  boxShadow: '0 1px 8px rgba(26, 18, 8, 0.04)',
  padding: '1.05rem 0.95rem 0.95rem',
  display: 'grid',
  gap: '0.85rem',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: '0.75rem',
}

const titleStyle: CSSProperties = {
  margin: 0,
  color: '#1a1208',
  fontFamily: 'var(--font-literata), Georgia, serif',
  fontSize: '1rem',
  fontWeight: 700,
}

const wordmarkStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-literata), serif',
  fontStyle: 'italic',
  fontSize: '0.78rem',
  color: '#1a1208',
  lineHeight: 1,
}

const shareButtonStyle: CSSProperties = {
  minHeight: 38,
  padding: '0 0.82rem',
  border: '1px solid #ddd6c7',
  borderRadius: 999,
  background: '#fffdf8',
  color: '#1a1208',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '0.35rem',
  fontSize: '0.78rem',
  fontWeight: 600,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const statementStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-literata), serif',
  fontStyle: 'italic',
  fontSize: 18,
  color: '#1a1208',
  lineHeight: 1.4,
}

const circlesWrapStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  justifyContent: 'center',
  alignItems: 'flex-start',
  columnGap: 16,
  rowGap: 20,
}

const overflowStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: '#8a8070',
  textAlign: 'center',
}

const tierStyle: CSSProperties = {
  margin: 0,
  fontSize: 13,
  color: '#1a1208',
}

const rarestStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: '#8a8070',
}

const attributionStyle: CSSProperties = {
  margin: 0,
  fontSize: 11,
  color: '#8a8070',
}
