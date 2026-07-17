'use client'

import { useState, useMemo, type CSSProperties } from 'react'
import {
  getPortraitCircleSize,
  type CircleSizingTier,
} from '@/lib/knowledge/circle-sizing'
import { normalizeBroadCategory } from '@/lib/knowledge/broad-category'
import { KnowledgeBubble } from '@/components/knowledge/KnowledgeBubble'
import { FrequencyMark } from '@/components/knowledge/FrequencyMark'
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy'
import {
  TERRITORY_FREQUENCIES,
  TERRITORY_FREQUENCY_COPY,
  TERRITORY_FREQUENCY_LABEL,
  type TerritoryFrequency,
} from '@/lib/daily/territory-model'
import type { MasteryTier } from '@/types/db'

type PortraitTier = MasteryTier
type SortMode = 'domain' | 'mastery' | 'frequency'

export type PortraitEntry = {
  canonicalSubcategory: string
  broadCategory: string
  totalMasteryPoints: number
  tier: PortraitTier
  authoredAnsweredCount: number
}

type PortraitCirclesProps = {
  entries: PortraitEntry[]
  /**
   * Rotation word ("Often" / "Sometimes" / "Blue Moon" / "Never") shown under
   * each circle's name. Returns null to omit the line for a given domain.
   */
  frequencyLabelFor?: (canonicalSubcategory: string) => string | null
  /** Tap handler for a circle — opens the domain's detail pop-up. */
  onSelectDomain?: (canonicalSubcategory: string) => void
  /**
   * Initial sort tab. Defaults to 'domain'. 'frequency' only takes effect when
   * `frequencyLabelFor` is provided (otherwise that tab isn't rendered), so it
   * falls back to 'domain' when rotation data isn't threaded in.
   */
  defaultSortMode?: SortMode
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

// ── Rotation frequency indicator ──────────────────────────────────────────────
// The rotation word alone ("Sometimes" / "Never" / …) read as an undifferentiated
// grey line — you couldn't tell one circle's rotation from another at a glance.
// A tiny 3-dot meter fixes that: filled-dot count encodes rotation depth so the
// whole grid scans without reading a word (Often ●●●, Sometimes ●●○, Never ○○○).
// Invert the single-source label map so the string coming through
// `frequencyLabelFor` resolves back to its enum (so the shared FrequencyMark can
// draw the right glyph) without the caller having to pass both.
const FREQUENCY_BY_LABEL: Record<string, TerritoryFrequency> = Object.fromEntries(
  (Object.entries(TERRITORY_FREQUENCY_LABEL) as [TerritoryFrequency, string][]).map(
    ([freq, label]) => [label, freq]
  )
)

// The shared rotation signal mark alone (D-FREQUENCY-MARK-01, decision E), with
// the rotation word dropped — the icon carries the meaning on its own. The mark
// inherits the domain's category color on this single-domain face (decision D)
// — `often`/`sometimes` ascending bars, `resting` the washed baseline line,
// `blue_moon` the blue crescent. With no adjacent text label, the mark
// self-labels (non-decorative) so screen readers still announce the frequency.
function FrequencyTag({ label, color }: { label: string; color: string }) {
  const freq = FREQUENCY_BY_LABEL[label] ?? null
  if (!freq) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        // Indicators sit above the title now; hold them back to 80% so they
        // read as a quiet signal rather than competing with the name.
        opacity: 0.8,
      }}
    >
      <FrequencyMark frequency={freq} color={color} size={11} />
    </span>
  )
}

const SPARSE_THRESHOLD = 5

type SectionGroup = { label: string; color: string; entries: PortraitEntry[] }

type Section = {
  label: string
  color: string
  entries: PortraitEntry[]
  /** Set on frequency-mode sections: drives the configure-page-style zone
   *  header (serif title + rotation mark + copy line). */
  frequency?: TerritoryFrequency
  copy?: string
  /** Frequency-mode secondary grouping by category, mirroring the configure
   *  page's zones: heaviest category first, the catch-all bucket last. */
  groups?: SectionGroup[]
}

// Category sub-groups within a frequency bucket — the same ordering the
// configure page (TerritorySetupClient.groupByCategory) uses: heaviest
// category first, ties alphabetical, "General Knowledge" (shown as "Other
// interests") always last. Entries within a category sort by points.
function groupEntriesByCategory(entries: PortraitEntry[]): SectionGroup[] {
  const byCategory = new Map<string, PortraitEntry[]>()
  for (const e of entries) {
    const category = normalizeBroadCategory(e.broadCategory) ?? 'General Knowledge'
    const list = byCategory.get(category) ?? []
    list.push(e)
    byCategory.set(category, list)
  }
  return [...byCategory.entries()]
    .map(([category, items]) => ({
      category,
      items: [...items].sort((a, b) => b.totalMasteryPoints - a.totalMasteryPoints),
      totalPoints: items.reduce((sum, e) => sum + e.totalMasteryPoints, 0),
    }))
    .sort((a, b) => {
      if (a.category === 'General Knowledge') return 1
      if (b.category === 'General Knowledge') return -1
      return b.totalPoints - a.totalPoints || a.category.localeCompare(b.category)
    })
    .map(({ category, items }) => ({
      label: displaySectionLabel(category),
      color: getPortraitDomainColor(category).text,
      entries: items,
    }))
}

// Exported for tests only — the component is the sole runtime caller.
export function buildSections(
  entries: PortraitEntry[],
  sortMode: SortMode,
  frequencyFor?: (canonicalSubcategory: string) => TerritoryFrequency | null
): Section[] {
  if (sortMode === 'frequency') {
    // Rotation-depth order (Often → Sometimes → Blue Moon → Never). A domain
    // whose frequency can't be resolved has no explicit rotation, which is
    // what "Never" (resting) means — bucket it there rather than dropping it.
    return TERRITORY_FREQUENCIES.map((freq) => {
      const groups = groupEntriesByCategory(
        entries.filter(
          (e) => (frequencyFor?.(e.canonicalSubcategory) ?? 'resting') === freq
        )
      )
      return {
        label: TERRITORY_FREQUENCY_LABEL[freq],
        color: 'var(--warm-ink-700)',
        frequency: freq,
        copy: TERRITORY_FREQUENCY_COPY[freq],
        entries: groups.flatMap((g) => g.entries),
        groups,
      }
    }).filter((s) => s.entries.length > 0)
  }
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
  showCount = true,
  circleScale = 1,
  selected = false,
  frequencyLabel = null,
  onSelectDomain,
}: {
  entry: PortraitEntry
  maxPointsForTier: number
  showCount?: boolean
  circleScale?: number
  selected?: boolean
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
  const showMasteryCount =
    showCount &&
    entry.tier !== 'establishing' &&
    entry.authoredAnsweredCount > 0
  const countFontSize = Math.min(48, Math.max(10, Math.round(size * 0.13)))

  const handleClick = () => {
    onSelectDomain?.(entry.canonicalSubcategory)
  }

  const interactive = Boolean(onSelectDomain)

  return (
    <div
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? `View ${entry.canonicalSubcategory} details` : undefined}
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
        width: Math.max(90, size + 8),
        maxWidth: '100%',
        cursor: interactive ? 'pointer' : undefined,
        userSelect: interactive ? 'none' : undefined,
      }}
    >
      <div style={{ position: 'relative', width: size, height: size }}>
        {/* Full-opacity fill + a hairline category border and a soft lift —
            the flat portrait mirrors the configure page's circle treatment
            (darker, crisper) rather than fading low-point domains. Size, not
            opacity, carries depth. */}
        <KnowledgeBubble
          diameter={size}
          tint={dc.primary}
          border={`1px solid color-mix(in srgb, ${dc.primary} 27%, transparent)`}
          style={{ boxShadow: 'var(--shadow-card-strong)' }}
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
      </div>
      {frequencyLabel ? (
        <FrequencyTag label={frequencyLabel} color={dc.primary} />
      ) : null}
      <span
        style={{
          fontSize: 10.5,
          color: dc.text,
          fontFamily: 'var(--font-serif)',
          textAlign: 'center',
          lineHeight: 1.3,
          maxWidth: Math.max(90, size),
          wordWrap: 'break-word',
        }}
      >
        {entry.canonicalSubcategory}
      </span>
    </div>
  )
}

export function PortraitCircles({
  entries,
  frequencyLabelFor,
  onSelectDomain,
  defaultSortMode = 'domain',
}: PortraitCirclesProps) {
  // 'frequency' is only a valid tab when rotation data is threaded in; clamp to
  // 'domain' otherwise so the initial mode always matches a rendered tab.
  const [sortMode, setSortMode] = useState<SortMode>(
    defaultSortMode === 'frequency' && !frequencyLabelFor ? 'domain' : defaultSortMode,
  )

  const validEntries = useMemo(
    () =>
      entries.map((entry) => ({
        ...entry,
        broadCategory: normalizeBroadCategory(entry.broadCategory) ?? 'General Knowledge',
      })),
    [entries]
  )
  const isSparse = validEntries.length < SPARSE_THRESHOLD
  // Frequency sort groups by the same rotation the label/mark under each circle
  // shows — resolve the label back to its enum so face and grouping agree.
  const frequencyFor = frequencyLabelFor
    ? (canonicalSubcategory: string): TerritoryFrequency | null => {
        const label = frequencyLabelFor(canonicalSubcategory)
        return label ? (FREQUENCY_BY_LABEL[label] ?? null) : null
      }
    : undefined
  const sections = buildSections(validEntries, sortMode, frequencyFor)

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
        {/* Frequency grouping only makes sense where rotation data is threaded
            in (the owner's knowledge page); other portraits keep two modes. */}
        {(
          [
            { mode: 'domain', label: 'Domain' },
            { mode: 'mastery', label: 'Mastery' },
            ...(frequencyLabelFor
              ? [{ mode: 'frequency', label: 'Frequency' } as const]
              : []),
          ] as const
        ).map(({ mode, label }) => (
          <button
            key={mode}
            type="button"
            onClick={() => setSortMode(mode)}
            style={sortMode === mode ? activeToggleStyle : inactiveToggleStyle}
            aria-pressed={sortMode === mode}
          >
            {label}
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
      ) : sortMode === 'frequency' ? (
        // Frequency mode needs no legend — its zone headers already carry the
        // rotation mark, label, and copy.
        null
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
        {sections.map(({ label, color, entries: sectionEntries, frequency, copy, groups }) => {
          const circlesRow = (rowEntries: PortraitEntry[]) => (
            <div style={circlesRowStyle}>
              {rowEntries.map((entry) => (
                <PortraitDomainCircle
                  key={entry.canonicalSubcategory}
                  entry={entry}
                  maxPointsForTier={maxPointsByTier[entry.tier] ?? 1}
                  frequencyLabel={frequencyLabelFor?.(entry.canonicalSubcategory) ?? null}
                  onSelectDomain={onSelectDomain}
                />
              ))}
            </div>
          )

          return (
            <div key={label} style={{ marginTop: 24 }}>
              {frequency ? (
                // Frequency sections mirror the configure page's zone header:
                // serif title with the rotation mark beside it + the shared
                // one-line copy, so the two rotation surfaces read as one.
                <div
                  style={{
                    marginBottom: 14,
                    paddingBottom: 10,
                    borderBottom: '1px solid var(--border-light)',
                  }}
                >
                  <h3
                    style={{
                      margin: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 20,
                      fontFamily: 'var(--font-serif)',
                      fontWeight: 600,
                      color: 'var(--ink)',
                    }}
                  >
                    {label}
                    <FrequencyMark
                      frequency={frequency}
                      color="var(--brand-ink-400)"
                      size={18}
                      decorative
                    />
                  </h3>
                  {copy ? (
                    <p
                      style={{
                        margin: '4px 0 0',
                        fontSize: 13,
                        lineHeight: 1.5,
                        color: 'var(--text-muted-warm)',
                      }}
                    >
                      {copy}
                    </p>
                  ) : null}
                </div>
              ) : (
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
              )}
              {groups ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                  {groups.map((group) => (
                    <div key={group.label}>
                      {/* Category sub-header, only when a zone spans more than
                          one category — same rule as the configure page. */}
                      {groups.length > 1 ? (
                        <p
                          style={{
                            margin: '0 0 8px',
                            fontSize: 11,
                            fontWeight: 600,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                            color: group.color,
                          }}
                        >
                          {group.label}
                        </p>
                      ) : null}
                      {circlesRow(group.entries)}
                    </div>
                  ))}
                </div>
              ) : (
                circlesRow(sectionEntries)
              )}
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

// Each item's height hugs its own circle and rows center on a shared axis —
// a small circle next to a large one must not inherit the large one's square
// slot (that stranded labels ~100px below establishing-tier bubbles).
const circlesRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 14,
  alignItems: 'center',
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
