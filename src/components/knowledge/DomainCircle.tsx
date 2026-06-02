import {
  DOMAIN_ICON_COMPONENTS,
  DomainInitialIcon,
} from '@/components/icons/domain-icons'
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category'
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles'
import { KnowledgeBubble, domainBubbleGradient } from '@/components/knowledge/KnowledgeBubble'
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy'
import type { MasteryTier } from '@/types/db'
import type { CSSProperties } from 'react'

type DomainCircleProps = {
  diameter: number
  iconKey: string
  canonicalSubcategory: string
  currentTier: MasteryTier | null
  showYourQs?: number
  highlighted?: boolean
  id?: string
  isGhost?: boolean
  /** Whether to render the tier label below the domain name. Defaults to true. */
  showTierLabel?: boolean
  territoryType?: 'declared' | 'demonstrated'
  broadCategory?: string | null
  circleSlotSize?: number
  onTap?: () => void
}

export function DomainCircle({
  diameter,
  iconKey,
  canonicalSubcategory,
  currentTier,
  showYourQs = 0,
  highlighted = false,
  id,
  isGhost = false,
  showTierLabel = true,
  territoryType,
  broadCategory,
  circleSlotSize,
  onTap,
}: DomainCircleProps) {
  const iconSize = Math.round(diameter * 0.4)
  const Icon = (
    DOMAIN_ICON_COMPONENTS as Record<
      string,
      | (typeof DOMAIN_ICON_COMPONENTS)[keyof typeof DOMAIN_ICON_COMPONENTS]
      | undefined
    >
  )[iconKey]
  const yourQsCount = Math.min(showYourQs, 5)
  const normalizedCategory = normalizeBroadCategory(broadCategory) ?? null
  const domainColor = normalizedCategory
    ? getPortraitDomainColor(normalizedCategory)
    : null
  const circleBackground = domainColor
    ? domainBubbleGradient(domainColor.light)
    : territoryType === 'declared'
      ? 'rgba(245, 240, 232, 0.3)'
      : '#f5f0e8'
  const circleBorder = highlighted
    ? '#0a1f3d'
    : (domainColor?.primary ?? '#d4cfc7')
  const resolvedCircleSlotSize = Math.max(circleSlotSize ?? diameter, diameter)

  if (isGhost) {
    return (
      <div
        id={id}
        style={{
          textAlign: 'center',
          width: `${Math.max(80, resolvedCircleSlotSize + 20)}px`,
          pointerEvents: 'none',
        }}
        aria-hidden
      >
        <div
          style={{
            ...circleSlotStyle,
            width: `${resolvedCircleSlotSize}px`,
            height: `${resolvedCircleSlotSize}px`,
          }}
        >
          <KnowledgeBubble
            diameter={diameter}
            background="transparent"
            border="1px dashed #c8c0b0"
            opacity={0.5}
          >
            {Icon ? (
              <Icon size={iconSize} color="#0a1f3d" />
            ) : (
              <DomainInitialIcon
                size={iconSize}
                color="#0a1f3d"
                label={canonicalSubcategory}
              />
            )}
          </KnowledgeBubble>
        </div>
        <p style={{ ...nameStyle, opacity: 0.3 }}>{canonicalSubcategory}</p>
      </div>
    )
  }

  return (
    <div
      id={id}
      style={{
        textAlign: 'center',
        width: `${Math.max(80, resolvedCircleSlotSize + 20)}px`,
        cursor: onTap ? 'pointer' : undefined,
      }}
      onClick={onTap}
      role={onTap ? 'button' : undefined}
    >
      <div
        style={{
          ...circleSlotStyle,
          width: `${resolvedCircleSlotSize}px`,
          height: `${resolvedCircleSlotSize}px`,
        }}
      >
        <KnowledgeBubble
          diameter={diameter}
          background={circleBackground}
          border={`1px solid ${circleBorder}`}
          style={{
            transition: 'border-color 300ms ease, box-shadow 300ms ease',
            boxShadow: highlighted ? '0 0 8px #f0c060' : undefined,
          }}
        >
          {Icon ? (
            <Icon size={iconSize} color="#0a1f3d" />
          ) : (
            <DomainInitialIcon
              size={iconSize}
              color="#0a1f3d"
              label={canonicalSubcategory}
            />
          )}
        </KnowledgeBubble>
      </div>
      <p style={nameStyle}>{canonicalSubcategory}</p>
      {showTierLabel && currentTier && (
        <p style={tierStyle}>{KNOWLEDGE_TIER_LABEL[currentTier]}</p>
      )}
      {showYourQs > 0 && (
        <div
          style={dotsWrapStyle}
          aria-label={`Your questions: ${showYourQs > 5 ? '5+' : showYourQs}`}
        >
          {Array.from({ length: yourQsCount }).map((_, index) => (
            <span
              key={`${canonicalSubcategory}-dot-${index}`}
              style={dotStyle}
            />
          ))}
          {showYourQs > 5 && <span style={plusStyle}>5+</span>}
        </div>
      )}
    </div>
  )
}

const circleSlotStyle: CSSProperties = {
  margin: '0 auto',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const nameStyle: CSSProperties = {
  marginTop: '8px',
  fontSize: '11px',
  color: '#0a1f3d',
  lineHeight: 1.25,
  overflowWrap: 'anywhere',
}

const tierStyle: CSSProperties = {
  marginTop: '2px',
  fontSize: '10px',
  color: '#8a8a8a',
}

const dotsWrapStyle: CSSProperties = {
  display: 'inline-flex',
  gap: '4px',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: '4px',
}

const dotStyle: CSSProperties = {
  width: '6px',
  height: '6px',
  borderRadius: '999px',
  background: '#8a8a8a',
}

const plusStyle: CSSProperties = {
  fontSize: '10px',
  color: '#8a8a8a',
  marginLeft: '2px',
}
