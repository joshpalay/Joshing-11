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

// Default copy for the 'needs_human' recheck status: the reviewer couldn't
// confidently resolve it either way. This is a genuine third outcome, not a
// disguised "no" — say so plainly rather than reusing reject's wording. Used
// as a fallback when the reviewer's `reason` text isn't available. Previously
// each of the four recheck call sites hand-wrote a slightly different 'Flagged
// for a human look.' string; unified here so "Argue your point" reads the same
// everywhere (B-ARGUE-01).
export const NEEDS_HUMAN_RECHECK_FALLBACK_MESSAGE =
  'You might be onto something. A person will take a look.'

// Default copy for a plain 'rejected' recheck when the reviewer's reason is missing.
export const REJECTED_RECHECK_FALLBACK_MESSAGE = 'Rechecked and still marked wrong.'

// The verdict line for a recheck that did NOT flip the answer, rebuilt from the
// stored slot fields. A rejected appeal used to leave the round card with no
// word at all once the sheet closed, or after a reload (QA 2026-10-11, S1).
// Null when there was no recheck, or when it was accepted (the card is then
// correct and says so itself).
export function recheckVerdictText(
  status: 'accepted' | 'rejected' | 'needs_human' | 'disputed' | null | undefined,
  reason: string | null | undefined,
): string | null {
  if (!status || status === 'accepted') return null
  if (reason) return reason
  if (status === 'disputed') return DISPUTED_RECHECK_FALLBACK_MESSAGE
  if (status === 'needs_human') return NEEDS_HUMAN_RECHECK_FALLBACK_MESSAGE
  return REJECTED_RECHECK_FALLBACK_MESSAGE
}

// "Argue your point" (B-ARGUE-01): the optional written-case textarea's hard
// cap, enforced client-side (the counter + maxLength) and re-checked server
// side in every recheck route so it can't be bypassed by calling the API
// directly.
export const ARGUE_YOUR_POINT_MAX_LENGTH = 300
