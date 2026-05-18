'use client'

import { useState, useMemo, type CSSProperties } from 'react'
import {
  getDomainCircleSize,
  type CircleSizingTier,
} from '@/lib/knowledge/circle-sizing'
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category'

type PortraitTier = 'establishing' | 'familiar' | 'solid' | 'mastery'
type SortMode = 'domain' | 'mastery'

export type PortraitEntry = {
  canonicalSubcategory: string
  broadCategory: string
  totalMasteryPoints: number
  tier: PortraitTier
  authoredAnsweredCount: number
  isHidden?: boolean
}

type PortraitCirclesProps = {
  entries: PortraitEntry[]
  editMode?: boolean
  onToggleHidden?: (canonicalSubcategory: string, nextHidden: boolean) => void
  pendingDomain?: string | null
}

const TIER_ORDER: PortraitTier[] = [
  'mastery',
  'solid',
  'familiar',
  'establishing',
]

const TIER_DISPLAY: Record<PortraitTier, string> = {
  establishing: 'Establishing',
  familiar: 'Familiar',
  solid: 'Solid',
  mastery: 'Mastery',
}

type DomainColor = {
  primary: string
  light: string
  text: string
}

const DOMAIN_COLORS: Record<string, DomainColor> = {
  Literature: {
    primary: '#c0392b',
    light: 'rgba(192,57,43,0.12)',
    text: '#8b1a0e',
  },
  Music: {
    primary: '#1a6b8a',
    light: 'rgba(26,107,138,0.12)',
    text: '#0e4060',
  },
  'Film & Television': {
    primary: '#6b3fa0',
    light: 'rgba(107,63,160,0.12)',
    text: '#3d1f6b',
  },
  'Architecture & Design': {
    primary: '#b07d2e',
    light: 'rgba(176,125,46,0.12)',
    text: '#7a5010',
  },
  'Food & Cuisine': {
    primary: '#2e8b57',
    light: 'rgba(46,139,87,0.12)',
    text: '#0e5c30',
  },
  Technology: {
    primary: '#3a6b8a',
    light: 'rgba(58,107,138,0.12)',
    text: '#1a3f5c',
  },
  Sports: {
    primary: '#c06b1a',
    light: 'rgba(192,107,26,0.12)',
    text: '#8b3e0e',
  },
  History: {
    primary: '#5a6b7a',
    light: 'rgba(90,107,122,0.12)',
    text: '#2a3f50',
  },
  Science: {
    primary: '#5a7a2e',
    light: 'rgba(90,122,46,0.12)',
    text: '#2a4a0e',
  },
  Philosophy: {
    primary: '#7a5a8a',
    light: 'rgba(122,90,138,0.12)',
    text: '#4a2a5c',
  },
  'Pop Culture': {
    primary: '#8a2a4a',
    light: 'rgba(138,42,74,0.12)',
    text: '#5c0e2a',
  },
  Language: {
    primary: '#4a7a5a',
    light: 'rgba(74,122,90,0.12)',
    text: '#1e4e30',
  },
}

function hashColor(str: string): DomainColor {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  const hue = Math.abs(h) % 360
  return {
    primary: `hsl(${hue},45%,35%)`,
    light: `hsla(${hue},45%,35%,0.12)`,
    text: `hsl(${hue},45%,25%)`,
  }
}

export function getPortraitDomainColor(domain: string): DomainColor {
  return DOMAIN_COLORS[domain] ?? hashColor(domain)
}

const SPARSE_THRESHOLD = 5
const MIN_OPACITY = 0.22

export function getPortraitCircleOpacity(pts: number, maxPts: number): number {
  const n = pts / Math.max(maxPts, 1)
  return MIN_OPACITY + n * (1 - MIN_OPACITY)
}

type Section = { label: string; color: string; entries: PortraitEntry[] }

function buildSections(
  entries: PortraitEntry[],
  sortMode: SortMode
): Section[] {
  if (sortMode === 'domain') {
    const domainMap = new Map<string, PortraitEntry[]>()
    for (const e of entries) {
      const broadCategory = normalizeBroadCategory(e.broadCategory) ?? 'General Knowledge'
      const normalizedEntry = { ...e, broadCategory }
      const list = domainMap.get(broadCategory) ?? []
      list.push(normalizedEntry)
      domainMap.set(broadCategory, list)
    }
    return Array.from(domainMap.entries())
      .map(([domain, cats]) => ({
        label: domain,
        color: getPortraitDomainColor(domain).primary,
        entries: [...cats].sort(
          (a, b) => b.totalMasteryPoints - a.totalMasteryPoints
        ),
      }))
      .sort((a, b) => {
        const sumA = a.entries.reduce((s, e) => s + e.totalMasteryPoints, 0)
        const sumB = b.entries.reduce((s, e) => s + e.totalMasteryPoints, 0)
        return sumB - sumA
      })
  }
  return TIER_ORDER.map((tier) => ({
    label: TIER_DISPLAY[tier],
    color: '#6b5535',
    entries: entries
      .filter((e) => e.tier === tier)
      .sort((a, b) => b.totalMasteryPoints - a.totalMasteryPoints),
  })).filter((s) => s.entries.length > 0)
}

export function PortraitDomainCircle({
  entry,
  maxPointsForTier,
  forceFullOpacity = false,
  showCount = true,
  circleScale = 1,
  selected = false,
  circleSlotSize,
  editMode = false,
  onToggleHidden,
  pending = false,
}: {
  entry: PortraitEntry
  maxPointsForTier: number
  forceFullOpacity?: boolean
  showCount?: boolean
  circleScale?: number
  selected?: boolean
  circleSlotSize?: number
  editMode?: boolean
  onToggleHidden?: (canonicalSubcategory: string, nextHidden: boolean) => void
  pending?: boolean
}) {
  const broadCategory = normalizeBroadCategory(entry.broadCategory) ?? 'General Knowledge'
  const dc = getPortraitDomainColor(broadCategory)
  const size = Math.round(
    getDomainCircleSize(
      entry.tier as CircleSizingTier,
      entry.totalMasteryPoints,
      maxPointsForTier
    ) * circleScale
  )
  const baseOpacity = forceFullOpacity
    ? 1
    : getPortraitCircleOpacity(entry.totalMasteryPoints, maxPointsForTier)
  const isHidden = Boolean(entry.isHidden)
  const dimForHidden = editMode && isHidden
  const opacity = dimForHidden ? baseOpacity * 0.35 : baseOpacity
  const labelOpacity =
    (0.5 + (entry.totalMasteryPoints / Math.max(maxPointsForTier, 1)) * 0.5) *
    (dimForHidden ? 0.5 : 1)
  const showMasteryCount =
    showCount &&
    entry.tier !== 'establishing' &&
    entry.authoredAnsweredCount > 0
  const resolvedCircleSlotSize = Math.max(circleSlotSize ?? size, size)

  const handleClick = () => {
    if (!editMode || !onToggleHidden || pending) return
    onToggleHidden(entry.canonicalSubcategory, !isHidden)
  }

  const interactive = editMode && Boolean(onToggleHidden)

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={interactive ? isHidden : undefined}
      aria-label={
        interactive
          ? `${isHidden ? 'Show' : 'Hide'} ${entry.canonicalSubcategory} ${isHidden ? 'on your portrait' : 'from friends'}`
          : undefined
      }
      onClick={interactive ? handleClick : undefined}
      onKeyDown={
        interactive
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                handleClick()
              }
            }
          : undefined
      }
      style={{
        ...circleItemStyle,
        width: Math.max(90, resolvedCircleSlotSize + 8),
        cursor: interactive ? (pending ? 'wait' : 'pointer') : undefined,
        userSelect: interactive ? 'none' : undefined,
        opacity: pending ? 0.6 : 1,
      }}
    >
      <div
        style={{
          ...portraitCircleSlotStyle,
          width: resolvedCircleSlotSize,
          height: resolvedCircleSlotSize,
        }}
      >
        <div style={{ position: 'relative', width: size, height: size }}>
          <div
            style={{
              width: size,
              height: size,
              borderRadius: '50%',
              background: `radial-gradient(circle at 38% 38%, ${dc.light.replace('0.12', '0.22')}, ${dc.light})`,
              opacity,
              flexShrink: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              filter: dimForHidden ? 'grayscale(0.6)' : undefined,
            }}
          >
            {showMasteryCount && (
              <span
                style={{
                  fontSize: size > 52 ? 13 : 10,
                  color: dc.primary,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  fontWeight: 'bold',
                  lineHeight: 1,
                }}
              >
                {entry.authoredAnsweredCount}
              </span>
            )}
          </div>
          {selected && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                inset: -4,
                borderRadius: '50%',
                border: `2px solid ${dc.primary}`,
                display: 'grid',
                placeItems: 'center',
                pointerEvents: 'none',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  fontSize: 12,
                  color: dc.primary,
                }}
              >
                ✓
              </span>
            </div>
          )}
          {editMode && (
            <div
              aria-hidden
              style={{
                position: 'absolute',
                top: -4,
                right: -4,
                width: 22,
                height: 22,
                borderRadius: '50%',
                background: isHidden ? '#faf8f2' : '#1a1208',
                color: isHidden ? '#1a1208' : '#faf8f2',
                border: `1.5px solid ${isHidden ? '#1a1208' : '#1a1208'}`,
                display: 'grid',
                placeItems: 'center',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'Georgia, "Times New Roman", serif',
                lineHeight: 1,
                boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
              }}
            >
              {isHidden ? '+' : '×'}
            </div>
          )}
        </div>
      </div>
      <span
        style={{
          fontSize: 10.5,
          color: dc.text,
          fontFamily: 'Georgia, "Times New Roman", serif',
          textAlign: 'center',
          lineHeight: 1.3,
          maxWidth: 90,
          wordWrap: 'break-word',
          opacity: labelOpacity,
          textDecoration: dimForHidden ? 'line-through' : undefined,
        }}
      >
        {entry.canonicalSubcategory}
      </span>
    </div>
  )
}

function getPortraitEntryCircleSize(
  entry: PortraitEntry,
  maxPointsForTier: number
): number {
  return Math.round(
    getDomainCircleSize(
      entry.tier as CircleSizingTier,
      entry.totalMasteryPoints,
      maxPointsForTier
    )
  )
}

export function PortraitCircles({ entries, editMode = false, onToggleHidden, pendingDomain = null }: PortraitCirclesProps) {
  const [sortMode, setSortMode] = useState<SortMode>('domain')

  const validEntries = useMemo(
    () =>
      entries
        .map((entry) => ({
          ...entry,
          broadCategory: normalizeBroadCategory(entry.broadCategory) ?? 'General Knowledge',
        }))
        .filter((e) => e.broadCategory && e.broadCategory !== 'General Knowledge'),
    [entries]
  )
  const isSparse = validEntries.length < SPARSE_THRESHOLD
  const sections = useMemo(
    () => buildSections(validEntries, sortMode),
    [validEntries, sortMode]
  )

  const maxPointsByTier = useMemo(() => {
    const result: Record<string, number> = {
      establishing: 1,
      familiar: 1,
      solid: 1,
      mastery: 1,
    }
    for (const e of validEntries) {
      if (e.totalMasteryPoints > (result[e.tier] ?? 1))
        result[e.tier] = e.totalMasteryPoints
    }
    return result
  }, [validEntries])
  const allDomains = [...new Set(validEntries.map((e) => e.broadCategory))]

  return (
    <div>
      <div style={toggleWrapStyle} aria-label="Portrait sort mode">
        {(['domain', 'mastery'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSortMode(mode)}
            style={sortMode === mode ? activeToggleStyle : inactiveToggleStyle}
            aria-pressed={sortMode === mode}
          >
            {mode === 'domain' ? 'Domain' : 'Mastery'}
          </button>
        ))}
      </div>

      {sortMode === 'domain' ? (
        <div style={legendStyle}>
          {allDomains.map((domain) => {
            const dc = getPortraitDomainColor(domain)
            return (
              <div key={domain} style={legendItemStyle}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: dc.primary,
                    opacity: 0.85,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 9.5, color: dc.text, opacity: 0.85 }}>
                  {domain}
                </span>
              </div>
            )
          })}
        </div>
      ) : (
        <div style={legendStyle}>
          {TIER_ORDER.map((tier) => (
            <div key={tier} style={legendItemStyle}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  backgroundColor: '#8b7355',
                  opacity: 0.4,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 9.5, color: '#8b7355' }}>
                {TIER_DISPLAY[tier]}
              </span>
            </div>
          ))}
          <span
            style={{
              fontSize: 9,
              color: '#b0a090',
              fontStyle: 'italic',
              marginLeft: 'auto',
              fontFamily: 'Georgia, "Times New Roman", serif',
            }}
          >
            Size = depth
          </span>
        </div>
      )}

      <p style={explainerStyle}>
        Numbers inside circles = questions you&apos;ve written that others have
        answered
      </p>

      <div>
        {sections.map(({ label, color, entries: sectionEntries }) => {
          const circleSlotSize = Math.max(
            ...sectionEntries.map((entry) =>
              getPortraitEntryCircleSize(
                entry,
                maxPointsByTier[entry.tier] ?? 1
              )
            ),
            0
          )

          return (
            <div key={label} style={{ marginTop: 24 }}>
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: '0.18em',
                  textTransform: 'uppercase',
                  color,
                  marginBottom: 14,
                  paddingBottom: 6,
                  borderBottom: `1px solid ${color}33`,
                  fontFamily: 'Georgia, "Times New Roman", serif',
                }}
              >
                {label}
              </div>
              <div style={circlesRowStyle}>
                {sectionEntries.map((entry) => (
                  <PortraitDomainCircle
                    key={entry.canonicalSubcategory}
                    entry={entry}
                    maxPointsForTier={maxPointsByTier[entry.tier] ?? 1}
                    circleSlotSize={circleSlotSize}
                    editMode={editMode}
                    onToggleHidden={onToggleHidden}
                    pending={pendingDomain === entry.canonicalSubcategory}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {isSparse && validEntries.length > 0 && (
        <p style={sparsePromptStyle}>
          Your portrait fills in as you play and write questions. Keep going.
        </p>
      )}
    </div>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const circleItemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 7,
  padding: '4px 2px',
}

const portraitCircleSlotStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

const circlesRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'flex-start',
}

const toggleWrapStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  gap: 8,
  marginBottom: '0.65rem',
}

const activeToggleStyle: CSSProperties = {
  minHeight: 34,
  padding: '0 14px',
  borderRadius: 999,
  border: 'none',
  background: '#1a1208',
  color: '#f5f0e8',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 14,
}

const inactiveToggleStyle: CSSProperties = {
  minHeight: 34,
  padding: '0 12px',
  borderRadius: 999,
  border: 'none',
  background: 'transparent',
  color: '#8a8070',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 14,
}

const legendStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: '6px 10px',
  alignItems: 'center',
  marginBottom: '0.5rem',
}

const legendItemStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 5,
}

const sparsePromptStyle: CSSProperties = {
  marginTop: 24,
  fontSize: 13,
  color: '#8a8070',
  fontStyle: 'italic',
  fontFamily: 'Georgia, "Times New Roman", serif',
  textAlign: 'center',
}

const explainerStyle: CSSProperties = {
  margin: '6px 0 0',
  fontSize: 9.5,
  color: '#b0a090',
  fontStyle: 'italic',
  fontFamily: 'Georgia, "Times New Roman", serif',
}
