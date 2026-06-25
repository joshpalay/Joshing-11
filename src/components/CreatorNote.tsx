import { type CSSProperties } from 'react'
import { INSIDE_JOKE_LABELS } from '@/lib/questions-types'

// Shared creator-note surface. ONE note region per question, whose treatment is
// chosen by PROVENANCE (who authored it), never by answer-state:
//
//   - human-authored  → bold inverted block (solid INK ground, cream text, hard
//                        border + 4×4 offset shadow — the house-card language).
//                        This is the loud one: a real person broke through.
//   - house / LLM     → quiet bronze editorial aside (short bronze accent bar +
//                        bronze uppercase label + dark-navy body, no fill/box).
//
// The accessible signal is the LABEL wording (human "Between you and {Name}" vs
// editorial "Between us!"), not the inversion or bronze alone (color alone must
// never convey meaning). cream (--warm-cream) on INK (--warm-ink) clears WCAG AA (~16:1).
export type CreatorNoteProvenance =
  | { kind: 'human'; authorName: string | null }
  | { kind: 'editorial' }

// 24px between the question explanation and the note (both treatments).
const GAP_FROM_EXPLANATION = 24

function firstName(name: string): string {
  return name.split(/\s+/)[0] || name
}

const LABEL_STYLE: CSSProperties = {
  fontSize: '0.62rem',
  fontWeight: 600,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
}

const BODY_STYLE: CSSProperties = {
  marginTop: 6,
  fontFamily: 'var(--font-serif), ui-serif, Georgia, serif',
  fontSize: 15,
  lineHeight: 1.5,
}

export function CreatorNote({
  text,
  provenance,
  style,
}: {
  text: string
  provenance: CreatorNoteProvenance
  style?: CSSProperties
}) {
  if (provenance.kind === 'human') {
    const label = provenance.authorName
      ? `Between you and ${firstName(provenance.authorName)}`
      : 'Between you and the author'
    return (
      <div style={{ marginTop: GAP_FROM_EXPLANATION, ...style }}>
        <div
          style={{
            background: 'var(--warm-ink)',
            color: 'var(--warm-cream)',
            // House-card language: hard 1.5px border + 4×4 offset shadow, no blur
            // (matches ShareCard/OverlapMap). The shadow casts INK onto the page.
            border: '1.5px solid var(--warm-ink)',
            boxShadow: '4px 4px 0 var(--warm-ink)',
            borderRadius: 4,
            padding: '14px 16px',
          }}
        >
          <p style={{ ...LABEL_STYLE, color: 'var(--warm-cream)' }}>{label}</p>
          <p style={{ ...BODY_STYLE, color: 'var(--warm-cream)' }}>{text}</p>
        </div>
      </div>
    )
  }

  // Editorial aside — a margin annotation, not a card: no fill, no border, no box.
  return (
    <div style={{ marginTop: GAP_FROM_EXPLANATION, position: 'relative', paddingLeft: 12, ...style }}>
      <span
        aria-hidden
        style={{
          position: 'absolute',
          left: 0,
          top: 1,
          width: 3,
          height: 30,
          borderRadius: 2,
          background: 'var(--accent-gold)',
        }}
      />
      {/* --accent-gold-ink is the AA-safe darkened gold for small text on cream. */}
      <p style={{ ...LABEL_STYLE, color: 'var(--accent-gold-ink)' }}>{INSIDE_JOKE_LABELS.editorial}</p>
      <p style={{ ...BODY_STYLE, color: 'var(--brand-ink)' }}>{text}</p>
    </div>
  )
}

// Selects the single note to show + its treatment, from a question's provenance:
//   - human author      → their creator_note, as the inverted block (no LLM aside)
//   - house / LLM       → creator_note if present, else the inside-joke line, as
//                         the bronze aside
// Returns null when there's nothing to show (e.g. a human who wrote no note).
export function pickCreatorNote(input: {
  isHuman: boolean
  authorName?: string | null
  creatorNote?: string | null
  insideJoke?: string | null
}): { text: string; provenance: CreatorNoteProvenance } | null {
  if (input.isHuman) {
    if (!input.creatorNote) return null
    return {
      text: input.creatorNote,
      provenance: { kind: 'human', authorName: input.authorName ?? null },
    }
  }
  const text = input.creatorNote ?? input.insideJoke ?? null
  if (!text) return null
  return { text, provenance: { kind: 'editorial' } }
}
