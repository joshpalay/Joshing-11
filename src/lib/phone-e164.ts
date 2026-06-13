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

// Progressively format raw user input as a US phone number for display in a
// text field: "(555) 123-4567". Strips non-digits, tolerates a leading "1"
// country code, caps at the 10 national digits, and formats partial input as
// the user types. Every downstream consumer normalizes by stripping non-digits
// (normalizePhone / normalizeToE164 / the looksLikeUsPhone validators), so the
// formatted string is safe to store as the field value.
export function formatUsPhoneInput(raw: string): string {
  let digits = raw.replace(/\D/g, '')
  // Drop a leading US country code so the 10 national digits format cleanly.
  if (digits.length > 10 && digits.startsWith('1')) {
    digits = digits.slice(1)
  }
  digits = digits.slice(0, 10)
  if (digits.length === 0) return ''
  if (digits.length < 4) return `(${digits}`
  if (digits.length < 7) return `(${digits.slice(0, 3)}) ${digits.slice(3)}`
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
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
