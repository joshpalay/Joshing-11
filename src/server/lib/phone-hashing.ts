import { createHash } from 'crypto';

// SHA-256(salt + e164Phone) — used by both the server-side User.phone_hash
// computation (added in B-Friends-4 at signup) and the ContactHash upload
// path. The client-side hashing path in B-Friends-4 MUST produce identical
// output for the same E.164 input + salt; a parity test will enforce this.
//
// The salt itself isn't a true secret — the client needs it to hash phone
// contacts before upload — but rotating it invalidates every ContactHash
// row and every persisted User.phone_hash.
export function hashPhoneNumber(e164Phone: string): string {
  const salt = process.env.PHONE_HASH_SALT;
  if (!salt) throw new Error('PHONE_HASH_SALT not set');
  return createHash('sha256')
    .update(salt + e164Phone)
    .digest('hex');
}
