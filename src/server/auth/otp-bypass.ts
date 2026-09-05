import { isUsPhoneNumber, normalizePhone } from './phone';

/**
 * Return the temporary OTP bypass code only for an explicitly allowlisted
 * phone. AUTH_OTP_BYPASS_PHONE takes a comma-separated list of one or more
 * numbers (a single number, the original shape, still works) so multiple test
 * accounts can share one bypass code without a real SMS ever sending. The
 * code is still required alongside at least one valid phone, so enabling the
 * bypass is deliberate and scoped to allowlisted test accounts only.
 */
export function getOtpBypassCodeForPhone(phone: string): string | null {
  const configuredPhones = (process.env.AUTH_OTP_BYPASS_PHONE ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && isUsPhoneNumber(entry));
  const configuredCode = process.env.AUTH_OTP_BYPASS_CODE?.trim();

  if (configuredPhones.length === 0 || !configuredCode || !/^\d{6}$/.test(configuredCode)) {
    return null;
  }

  const normalizedPhone = normalizePhone(phone);
  return configuredPhones.some((configured) => normalizePhone(configured) === normalizedPhone)
    ? configuredCode
    : null;
}
