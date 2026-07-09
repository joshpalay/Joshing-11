'use client'

import { useState, useMemo, type CSSProperties } from 'react'
import {
  getPortraitCircleSize,
  type CircleSizingTier,
} from '@/lib/knowledge/circle-sizing'
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category'
import { KnowledgeBubble } from '@/components/knowledge/KnowledgeBubble'
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy'
import {
  TERRITORY_FREQUENCY_LABEL,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model'
import type { MasteryTier } from '@/types/db'

type PortraitTier = MasteryTier
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
  /**
   * Rotation word ("Often" / "Sometimes" / "Blue Moon" / "Never") shown under
   * each circle's name. Returns null to omit the line for a given domain.
   */
  frequencyLabelFor?: (canonicalSubcategory: string) => string | null
  /**
   * Tap handler for a circle when NOT in edit mode — opens the domain's detail
   * pop-up. Edit mode keeps its own hide/show tap (onToggleHidden).
   */
  onSelectDomain?: (canonicalSubcategory: string) => void
}

const TIER_ORDER: PortraitTier[] = [
  'mastery',
  'solid',
  'familiar',
  'establishing',
]

type DomainColor = {
  primary: string
  text: string
}

// Section header relabel — "General Knowledge" is the catch-all bucket the
// categorizer falls back to, but it shouldn't be shown to users as a category
// name. ("Other" already normalizes to "General Knowledge" via
// normalizeBroadCategory.) Render those entries under a softer label.
const SECTION_LABEL_OVERRIDES: Record<string, string> = {
  'General Knowledge': 'Other interests',
  Other: 'Other interests',
}

function displaySectionLabel(broadCategory: string): string {
  return SECTION_LABEL_OVERRIDES[broadCategory] ?? broadCategory
}

// The per-domain hues live in the --cat-* token scale (globals.css,
// STYLE-GUIDE-COLOR §3) so they have one definition and the palette preview can
// flip them; this map only routes domain display names onto that scale. The
// soft circle fill derives from the primary at render (domainBubbleGradient),
// so no `light` variant exists anymore.
const DOMAIN_COLORS: Record<string, DomainColor> = {
  Literature: { primary: 'var(--cat-literature)', text: 'var(--cat-literature-text)' },
  Music: { primary: 'var(--cat-music)', text: 'var(--cat-music-text)' },
  'Film & Television': { primary: 'var(--cat-film-tv)', text: 'var(--cat-film-tv-text)' },
  'Architecture & Design': { primary: 'var(--cat-architecture)', text: 'var(--cat-architecture-text)' },
  'Food & Cuisine': { primary: 'var(--cat-food)', text: 'var(--cat-food-text)' },
  Technology: { primary: 'var(--cat-technology)', text: 'var(--cat-technology-text)' },
  Sports: { primary: 'var(--cat-sports)', text: 'var(--cat-sports-text)' },
  History: { primary: 'var(--cat-history)', text: 'var(--cat-history-text)' },
  Science: { primary: 'var(--cat-science)', text: 'var(--cat-science-text)' },
  Philosophy: { primary: 'var(--cat-philosophy)', text: 'var(--cat-philosophy-text)' },
  'Pop Culture': { primary: 'var(--cat-pop-culture)', text: 'var(--cat-pop-culture-text)' },
  Language: { primary: 'var(--cat-language)', text: 'var(--cat-language-text)' },
}

function hashColor(str: string): DomainColor {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  const hue = Math.abs(h) % 360
  return {
    primary: `hsl(${hue},45%,35%)`,
    text: `hsl(${hue},45%,25%)`,
  }
}

export function getPortraitDomainColor(domain: string): DomainColor {
  return DOMAIN_COLORS[domain] ?? hashColor(domain)
}

// Accent pair for an "expanding territory" row — keyed by the row's domain
// (STYLE-GUIDE-COLOR §3: color = category) instead of the old row-position
// red/gold/blue. Known domains ride the --cat-* scale; unknown ones get the
// deterministic hash hue — either way a territory keeps ONE color everywhere.
export function expandingTerritoryAccent(domain: string): { border: string; fill: string } {
  const c = getPortraitDomainColor(domain)
  return {
    border: c.primary,
    fill: `color-mix(in srgb, ${c.primary} 15%, transparent)`,
  }
}

// ── Rotation frequency badge ──────────────────────────────────────────────────
// The rotation word under each name ("Sometimes" / "Never" / …) read as an
// undifferentiated grey line and, spelled out under every circle, made the grid
// busy. Move it into a small badge on the circle's top-right corner instead: one
// glyph per circle, read as chrome rather than an inline field. The glyph is a
// moon phase — rotation is "how often a territory comes back around," a natural
// lunar-cycle metaphor, and it makes the existing Blue Moon literal one of a
// family: Often = full moon, Sometimes = half, Blue Moon = the blue crescent,
// Never = new (empty ring). Fuller = more often, so the grid scans at a glance;
// the word rides along as the badge's aria-label / hover title.
//
// Invert the single-source label map so the string coming through
// `frequencyLabelFor` resolves back to its enum (and thus its phase) without the
// caller having to pass both.
const FREQUENCY_BY_LABEL: Record<string, TerritoryFrequency> = Object.fromEntries(
  (Object.entries(TERRITORY_FREQUENCY_LABEL) as [TerritoryFrequency, string][]).map(
    ([freq, label]) => [label, freq]
  )
)

const MOON_INK = 'var(--warm-ink)'

// Moon-phase glyph for a rotation tier, drawn in a 24×24 viewBox. Blue Moon is
// the lucide crescent filled with the blue accent; the rest are neutral ink
// (color stays reserved for category, STYLE-GUIDE-COLOR §3).
function MoonPhaseGlyph({ freq, px }: { freq: TerritoryFrequency; px: number }) {
  const common = {
    width: px,
    height: px,
    viewBox: '0 0 24 24',
    'aria-hidden': true,
    style: { display: 'block' as const },
  }
  switch (freq) {
    case 'often':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="10" fill={MOON_INK} />
        </svg>
      )
    case 'sometimes':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9.3" fill="none" stroke={MOON_INK} strokeWidth={1.6} />
          <path d="M12 2.7 A9.3 9.3 0 0 1 12 21.3 Z" fill={MOON_INK} />
        </svg>
      )
    case 'blue_moon':
      return (
        <svg {...common}>
          <path
            d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"
            fill="var(--exploring-accent-blue)"
          />
        </svg>
      )
    case 'resting':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill="none" stroke="var(--warm-ink-400)" strokeWidth={1.6} />
        </svg>
      )
  }
}

// The corner badge itself — a paper chip pinned to the bubble's top-right so it
// reads as a rotation marker, not a second knowledge circle.
function RotationBadge({ label, dim }: { label: string; dim: boolean }) {
  const freq = FREQUENCY_BY_LABEL[label] ?? null
  if (!freq) return null
  return (
    <div
      role="img"
      aria-label={`Rotation: ${label}`}
      title={label}
      style={{
        position: 'absolute',
        top: -3,
        right: -3,
        width: 18,
        height: 18,
        borderRadius: '50%',
        background: 'var(--warm-paper)',
        border: '1px solid var(--warm-border-soft)',
        display: 'grid',
        placeItems: 'center',
        boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
        opacity: dim ? 0.5 : 1,
      }}
    >
      <MoonPhaseGlyph freq={freq} px={11} />
    </div>
  )
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
        label: displaySectionLabel(domain),
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
    label: KNOWLEDGE_TIER_LABEL[tier],
    color: 'var(--warm-ink-700)',
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
  frequencyLabel = null,
  onSelectDomain,
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
  frequencyLabel?: string | null
  onSelectDomain?: (canonicalSubcategory: string) => void
}) {
  const broadCategory = normalizeBroadCategory(entry.broadCategory) ?? 'General Knowledge'
  const dc = getPortraitDomainColor(broadCategory)
  const size = Math.round(
    getPortraitCircleSize(
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
  const countFontSize = Math.min(48, Math.max(10, Math.round(size * 0.13)))

  const handleClick = () => {
    if (pending) return
    if (editMode) {
      onToggleHidden?.(entry.canonicalSubcategory, !isHidden)
      return
    }
    onSelectDomain?.(entry.canonicalSubcategory)
  }

  const interactive =
    (editMode && Boolean(onToggleHidden)) || (!editMode && Boolean(onSelectDomain))

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-pressed={editMode && interactive ? isHidden : undefined}
      aria-label={
        !interactive
          ? undefined
          : editMode
            ? `${isHidden ? 'Show' : 'Hide'} ${entry.canonicalSubcategory} ${isHidden ? 'on your portrait' : 'from friends'}`
            : `View ${entry.canonicalSubcategory} details`
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
        maxWidth: '100%',
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
          <KnowledgeBubble
            diameter={size}
            tint={dc.primary}
            opacity={opacity}
            style={{ filter: dimForHidden ? 'grayscale(0.6)' : undefined }}
          >
            {showMasteryCount && (
              <span
                style={{
                  fontSize: countFontSize,
                  color: dc.primary,
                  fontFamily: 'var(--font-serif)',
                  fontWeight: 'bold',
                  lineHeight: 1,
                }}
              >
                {entry.authoredAnsweredCount}
              </span>
            )}
          </KnowledgeBubble>
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
                background: isHidden ? 'var(--warm-paper)' : 'var(--warm-ink)',
                color: isHidden ? 'var(--warm-ink)' : 'var(--warm-paper)',
                border: `1.5px solid var(--warm-ink)`,
                display: 'grid',
                placeItems: 'center',
                fontSize: 12,
                fontWeight: 700,
                fontFamily: 'var(--font-serif)',
                lineHeight: 1,
                boxShadow: '0 1px 3px rgba(0,0,0,0.18)',
              }}
            >
              {isHidden ? '+' : '×'}
            </div>
          )}
          {/* Rotation lives in the corner badge; the edit-mode +/× owns this
              corner while editing, so only show one at a time. */}
          {!editMode && frequencyLabel ? (
            <RotationBadge label={frequencyLabel} dim={dimForHidden} />
          ) : null}
        </div>
      </div>
      <span
        style={{
          fontSize: 10.5,
          color: dc.text,
          fontFamily: 'var(--font-serif)',
          textAlign: 'center',
          lineHeight: 1.3,
          maxWidth: Math.max(90, resolvedCircleSlotSize),
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
    getPortraitCircleSize(
      entry.tier as CircleSizingTier,
      entry.totalMasteryPoints,
      maxPointsForTier
    )
  )
}

export function PortraitCircles({
  entries,
  editMode = false,
  onToggleHidden,
  pendingDomain = null,
  frequencyLabelFor,
  onSelectDomain,
}: PortraitCirclesProps) {
  const [sortMode, setSortMode] = useState<SortMode>('domain')

  const validEntries = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        broadCategory: normalizeBroadCategory(entry.broadCategory) ?? 'General Knowledge',
      })),
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
                  {displaySectionLabel(domain)}
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
                  backgroundColor: 'var(--warm-ink-500)',
                  opacity: 0.4,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: 9.5, color: 'var(--warm-ink-500)' }}>
                {KNOWLEDGE_TIER_LABEL[tier]}
              </span>
            </div>
          ))}
          <span
            style={{
              fontSize: 9,
              color: 'var(--warm-ink-400)',
              fontStyle: 'italic',
              marginLeft: 'auto',
              fontFamily: 'var(--font-serif)',
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
                  fontFamily: 'var(--font-serif)',
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
                    frequencyLabel={frequencyLabelFor?.(entry.canonicalSubcategory) ?? null}
                    onSelectDomain={onSelectDomain}
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
  background: 'var(--warm-ink)',
  color: 'var(--warm-cream)',
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
  color: 'var(--warm-ink-400)',
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
  color: 'var(--warm-ink-400)',
  fontStyle: 'italic',
  fontFamily: 'var(--font-serif)',
  textAlign: 'center',
}

const explainerStyle: CSSProperties = {
  margin: '6px 0 0',
  fontSize: 9.5,
  color: 'var(--warm-ink-400)',
  fontStyle: 'italic',
  fontFamily: 'var(--font-serif)',
}
