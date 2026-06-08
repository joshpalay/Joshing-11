import type { CSSProperties } from 'react'

// The canonical answer rendered as a prominent serif headline — the "answer as
// headline" reveal treatment from the in-game result card (GameplayChat's
// ResultRow). Shared so every surface that reveals an answer — the in-game
// result card, the feed reveal sheet, the "answered by you" card, the game
// summary recap, and the answered-history list — sizes the answer identically.
//
// Apply the result tone on top of this (green `--game-correct` when the player
// nailed it, `--brand-ink` otherwise) so the headline still reads as a verdict.
export const answerHeadingStyle: CSSProperties = {
  fontFamily: 'var(--font-cormorant), Georgia, serif',
  fontSize: '1.65rem',
  fontWeight: 700,
  lineHeight: 1.14,
}
