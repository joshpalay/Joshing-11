// The leading sentence of a longer explanation. Answer-reveal surfaces show
// this one-line explainer directly under the answer; the full text lives in the
// End of Session Review (see GameplayChat's ResultRow), so nothing is lost.
// Shared so the in-game result card and the feed reveal sheet truncate
// identically.
export function firstSentence(text: string): string {
  const trimmed = text.trim()
  const match = trimmed.match(/^.*?[.!?](?=\s|$)/)
  return match ? match[0] : trimmed
}
