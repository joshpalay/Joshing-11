// The leading sentence of a longer explanation. Answer-reveal surfaces show
// this one-line explainer directly under the answer; the full text lives in the
// End of Session Review (see GameplayChat's ResultRow), so nothing is lost.
// Shared so the in-game result card and the feed reveal sheet truncate
// identically.

// Common abbreviations whose trailing period is NOT a sentence end. Without
// this guard the naive splitter cuts "The opening chorus of the St. Matthew
// Passion…" at "St.". Matched case-insensitively against the word immediately
// before a candidate break. Keep the trailing period off the entries here.
const ABBREVIATIONS = new Set([
  'st', // St. (Saint / Street) — the case that surfaced this bug
  'mr',
  'mrs',
  'ms',
  'dr',
  'prof',
  'sr',
  'jr',
  'vs',
  'etc',
  'no',
  'vol',
  'op', // Op. (musical opus number)
  'fig',
  'gen',
  'sen',
  'rep',
  'gov',
  'pres',
])

// Single capital-letter initials ("J. S. Bach", "U. S.") also end in a period
// followed by a space but never close a sentence.
function isAbbreviationBreak(textBeforePeriod: string): boolean {
  const lastWord = textBeforePeriod.match(/(\S+)$/)?.[1] ?? ''
  if (/^[A-Za-z]$/.test(lastWord)) return true
  return ABBREVIATIONS.has(lastWord.toLowerCase())
}

export function firstSentence(text: string): string {
  const trimmed = text.trim()
  // Walk each candidate terminator and accept the first that is a real sentence
  // end — i.e. not the period of a known abbreviation or a single initial.
  const terminator = /[.!?](?=\s|$)/g
  let match: RegExpExecArray | null
  while ((match = terminator.exec(trimmed)) !== null) {
    const end = match.index + 1
    const before = trimmed.slice(0, match.index)
    // `!`/`?` are unambiguous; only `.` can be an abbreviation period.
    if (match[0] !== '.' || !isAbbreviationBreak(before)) {
      return trimmed.slice(0, end)
    }
  }
  return trimmed
}
