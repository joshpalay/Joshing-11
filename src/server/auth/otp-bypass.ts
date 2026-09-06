import { isUsPhoneNumber, normalizePhone } from './phone';

// AUTH_OTP_BYPASS_PHONE takes a comma-separated list of one or more numbers
// (a single number, the original shape, still works), all sharing one
// AUTH_OTP_BYPASS_CODE. The code is the single on/off switch for the whole
// mechanism — an empty/invalid code disables it regardless of the phone list,
// so enabling it is always a deliberate, explicit choice.
function getBypassPhones(): string[] {
  return (process.env.AUTH_OTP_BYPASS_PHONE ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && isUsPhoneNumber(entry));
}

function bypassEnabled(): boolean {
  const code = process.env.AUTH_OTP_BYPASS_CODE?.trim();
  return Boolean(code && /^\d{6}$/.test(code));
}

/**
 * Return the shared bypass code only for an explicitly allowlisted phone —
 * lets request-otp/verify-otp skip Twilio entirely for test accounts.
 */
export function getOtpBypassCodeForPhone(phone: string): string | null {
  if (!bypassEnabled()) return null;
  const configuredPhones = getBypassPhones();
  if (configuredPhones.length === 0) return null;

  const normalizedPhone = normalizePhone(phone);
  const matches = configuredPhones.some(
    (configured) => normalizePhone(configured) === normalizedPhone,
  );
  return matches ? process.env.AUTH_OTP_BYPASS_CODE!.trim() : null;
}

/**
 * Whether `phone` is one of the allowlisted test numbers — for sends that
 * aren't the OTP itself (e.g. the SMS opt-in confirmation) but still
 * shouldn't hit a real, undeliverable test number. Same allowlist and same
 * on/off switch as getOtpBypassCodeForPhone; this just skips the code.
 */
export function isBypassTestPhone(phone: string): boolean {
  if (!bypassEnabled()) return false;
  const normalizedPhone = normalizePhone(phone);
  return getBypassPhones().some((configured) => normalizePhone(configured) === normalizedPhone);
}
