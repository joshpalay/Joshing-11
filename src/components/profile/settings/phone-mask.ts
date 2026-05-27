export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 4) return value;
  const last = digits.slice(-4);
  if (digits.length === 11 && digits.startsWith('1')) {
    return `(•••) •••-${last}`;
  }
  if (digits.length === 10) {
    return `(•••) •••-${last}`;
  }
  return `••• ${last}`;
}
