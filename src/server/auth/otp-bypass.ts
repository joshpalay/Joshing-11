import { isUsPhoneNumber, normalizePhone } from './phone';

/**
 * Return the temporary OTP bypass code only for the explicitly allowlisted
 * phone. Both values are required so enabling the bypass is deliberate and
 * scoped to one test account.
 */
export function getOtpBypassCodeForPhone(phone: string): string | null {
  const configuredPhone = process.env.AUTH_OTP_BYPASS_PHONE?.trim();
  const configuredCode = process.env.AUTH_OTP_BYPASS_CODE?.trim();

  if (
    !configuredPhone ||
    !configuredCode ||
    !isUsPhoneNumber(configuredPhone) ||
    !/^\d{6}$/.test(configuredCode)
  ) {
    return null;
  }

  return normalizePhone(phone) === normalizePhone(configuredPhone) ? configuredCode : null;
}
