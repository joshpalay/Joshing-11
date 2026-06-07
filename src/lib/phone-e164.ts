import { parsePhoneNumber } from 'libphonenumber-js/min'

// Normalize a raw phone string to E.164 ("+15551234567"). US-only for
// Phase 1 — country-aware normalization is tracked as a fast-follow.
// Returns null when the input doesn't parse to a valid number; callers
// should skip those rows (the backfill script logs them).
export function normalizeToE164(raw: string, defaultCountry: 'US' = 'US'): string | null {
  try {
    const parsed = parsePhoneNumber(raw, defaultCountry)
    return parsed?.isValid() ? parsed.number : null
  } catch {
    return null
  }
}

// Mask a US E.164 number for display as "•••-•••-1234" (only the last four
// digits are shown). Used to surface an invite's target phone without leaking
// the full number to the client. Falls back to a fully masked placeholder when
// the input isn't a 10-digit US number.
export function maskPhoneE164(e164: string): string {
  const digits = e164.replace(/\D/g, '').replace(/^1/, '')
  if (digits.length !== 10) return '•••-•••-••••'
  return `•••-•••-${digits.slice(6)}`
}
