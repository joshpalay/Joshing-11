// Parity test: the client-side Web Crypto hashing in
// src/components/friends/ContactMatchBlock.tsx MUST produce identical
// output to server-side hashPhoneNumber() for the same salt + E.164 input.
// If they drift, contact matching silently breaks — the uploaded
// ContactHash rows won't equal the User.phone_hash they're meant to match.
//
// This test re-implements the client hashing logic inline (rather than
// importing it from the component, which is `'use client'` and pulls in
// React) and asserts byte-for-byte equality against the server impl.

import { describe, expect, it, beforeAll } from 'vitest'

import { hashPhoneNumber } from '../phone-hashing'

const SALT = 'parity-test-salt-not-for-prod-use'

async function hashPhoneClientEquivalent(salt: string, e164: string): Promise<string> {
  const data = new TextEncoder().encode(salt + e164)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

describe('phone-hashing parity', () => {
  beforeAll(() => {
    process.env.PHONE_HASH_SALT = SALT
  })

  it('produces identical 64-char hex for a typical US E.164 number', async () => {
    const e164 = '+14155551234'
    const server = hashPhoneNumber(e164)
    const client = await hashPhoneClientEquivalent(SALT, e164)
    expect(server).toBe(client)
    expect(server).toMatch(/^[a-f0-9]{64}$/)
  })

  it('produces different output for different inputs', async () => {
    const a = hashPhoneNumber('+14155551234')
    const b = hashPhoneNumber('+14155551235')
    expect(a).not.toBe(b)
  })

  it('handles a representative spread of E.164 inputs identically across impls', async () => {
    const inputs = [
      '+14155551234',
      '+19175550000',
      '+12125558888',
      '+18005551212',
    ]
    for (const e164 of inputs) {
      const server = hashPhoneNumber(e164)
      const client = await hashPhoneClientEquivalent(SALT, e164)
      expect(server).toBe(client)
    }
  })

  it('throws when the salt is unset', () => {
    const prev = process.env.PHONE_HASH_SALT
    delete process.env.PHONE_HASH_SALT
    try {
      expect(() => hashPhoneNumber('+14155551234')).toThrow(/PHONE_HASH_SALT/)
    } finally {
      process.env.PHONE_HASH_SALT = prev
    }
  })
})
