import { parsePhoneNumber } from 'libphonenumber-js/min';

// Normalize a raw phone string to E.164 ("+15551234567"). US-only for
// Phase 1 — country-aware normalization is tracked as a fast-follow.
// Returns null when the input doesn't parse to a valid number; callers
// should skip those rows (the backfill script logs them).
export function normalizeToE164(raw: string, defaultCountry: 'US' = 'US'): string | null {
  try {
    const parsed = parsePhoneNumber(raw, defaultCountry);
    return parsed?.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}
