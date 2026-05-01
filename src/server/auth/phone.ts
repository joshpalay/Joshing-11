const US_E164_REGEX = /^\+1\d{10}$/;

export function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return phone.startsWith('+') ? phone : `+${digits}`;
}

export function isUsPhoneNumber(phone: string): boolean {
  return US_E164_REGEX.test(normalizePhone(phone));
}
