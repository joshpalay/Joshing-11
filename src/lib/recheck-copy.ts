// Shared client-side copy so every recheck surface (Daily Five, catch-up, Feed,
// Lately milestone) reports the per-player daily quota (B-13.5) consistently.
export function appendRecheckQuotaNote(message: string, remaining: number | null | undefined): string {
  if (typeof remaining !== 'number' || remaining < 0) return message
  if (remaining === 0) return `${message} No rechecks left today.`
  return `${message} ${remaining} recheck${remaining === 1 ? '' : 's'} left today.`
}

// Default copy for the 'disputed' recheck status (B-13.2): the reviewer found a
// problem with the question itself, but the player's own answer didn't match
// either, so the grade stays wrong. Used as a fallback when the reviewer's
// `reason` text isn't available.
export const DISPUTED_RECHECK_FALLBACK_MESSAGE =
  'We think there may be a mistake in this question — flagging it for a closer look. Your answer is still marked wrong for now.'
