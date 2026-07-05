import { describe, expect, it } from 'vitest';

import {
  decodeVerifyCustomId,
  encodeVerifyCustomId,
} from '@/server/quality/verify-batch';
import { buildVerifyRequestParams } from '@/server/quality/verify-question';

// Pure parts only — batch submit/harvest orchestration touches the network + DB
// and is exercised in preview behind BATCH_VERIFY_ASYNC_ENABLED.

describe('verify custom_id codec', () => {
  it('round-trips both stores', () => {
    for (const store of ['q', 'g'] as const) {
      const id = 'a4f0c2de-1b3c-4d5e-8f90-0123456789ab';
      expect(decodeVerifyCustomId(encodeVerifyCustomId(store, id))).toEqual({ store, rowId: id });
    }
  });

  it('emits only characters the Batches API accepts (^[a-zA-Z0-9_-]{1,64}$)', () => {
    // Regression for the 2026-07-05 prod finding: the original colon separator
    // was REJECTED by the real API at submit — every async run silently no-oped.
    for (const store of ['q', 'g'] as const) {
      const encoded = encodeVerifyCustomId(store, 'a4f0c2de-1b3c-4d5e-8f90-0123456789ab');
      expect(encoded).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
    }
  });

  it('still decodes the legacy colon form defensively', () => {
    expect(decodeVerifyCustomId('q:row-1')).toEqual({ store: 'q', rowId: 'row-1' });
  });

  it('rejects malformed custom_ids instead of guessing a store', () => {
    expect(decodeVerifyCustomId('x:abc')).toBeNull();
    expect(decodeVerifyCustomId('q')).toBeNull();
    expect(decodeVerifyCustomId('')).toBeNull();
    expect(decodeVerifyCustomId('q:')).toBeNull();
    expect(decodeVerifyCustomId('q_')).toBeNull();
  });
});

describe('buildVerifyRequestParams — the shared sync/batch request', () => {
  const input = {
    questionText: 'Which symphony did Beethoven dedicate to a patron?',
    answer: 'Eroica',
    explanation: null,
    canonicalSubcategory: 'Beethoven',
    broadCategory: 'Music',
    dimensions: ['false_premise' as const],
  };

  it('carries the cached system prompt and the user payload', () => {
    const params = buildVerifyRequestParams(input);
    expect(params.max_tokens).toBe(1024);
    expect(Array.isArray(params.system)).toBe(true);
    const system = params.system as Array<{ text: string; cache_control?: { type: string } }>;
    expect(system[0]?.cache_control?.type).toBe('ephemeral');
    expect(system[0]?.text).toMatch(/fact-checking ONE already-published/);
    const content = params.messages[0]?.content;
    expect(typeof content).toBe('string');
    expect(content).toContain('<question>');
    expect(content).toContain('false_premise');
  });

  it('declares the web_search tool (grounding is load-bearing)', () => {
    const params = buildVerifyRequestParams(input);
    expect(params.tools?.[0]).toMatchObject({ type: 'web_search_20250305', name: 'web_search' });
  });

  it('restricts search to the wiki allowlist when VERIFY_WEB_SEARCH_ALLOWED_DOMAINS is set (F1)', () => {
    const prev = process.env.VERIFY_WEB_SEARCH_ALLOWED_DOMAINS;
    try {
      process.env.VERIFY_WEB_SEARCH_ALLOWED_DOMAINS = 'wikipedia.org, fandom.com';
      const params = buildVerifyRequestParams(input);
      expect(params.tools?.[0]).toMatchObject({
        allowed_domains: ['wikipedia.org', 'fandom.com'],
      });
    } finally {
      if (prev === undefined) delete process.env.VERIFY_WEB_SEARCH_ALLOWED_DOMAINS;
      else process.env.VERIFY_WEB_SEARCH_ALLOWED_DOMAINS = prev;
    }
  });

  it('leaves search unrestricted when the env var is unset (pre-existing behavior)', () => {
    const prev = process.env.VERIFY_WEB_SEARCH_ALLOWED_DOMAINS;
    try {
      delete process.env.VERIFY_WEB_SEARCH_ALLOWED_DOMAINS;
      const params = buildVerifyRequestParams(input);
      expect(params.tools?.[0]).not.toHaveProperty('allowed_domains');
    } finally {
      if (prev !== undefined) process.env.VERIFY_WEB_SEARCH_ALLOWED_DOMAINS = prev;
    }
  });
});
