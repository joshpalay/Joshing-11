import { describe, expect, it } from 'vitest';

import { FACT_KEY_MAX_CHARS, normalizeFactKey } from '@/server/questions/fact-key';

describe('normalizeFactKey', () => {
  it('returns null for non-strings, empty, and pure-punctuation input', () => {
    expect(normalizeFactKey(null)).toBeNull();
    expect(normalizeFactKey(undefined)).toBeNull();
    expect(normalizeFactKey('')).toBeNull();
    expect(normalizeFactKey('   ')).toBeNull();
    expect(normalizeFactKey('—//——')).toBeNull();
  });

  it('lowercases, slugifies, strips diacritics, and trims hyphens', () => {
    expect(normalizeFactKey('Götterdämmerung — Hagen summons vassals (instrument)')).toBe(
      'gotterdammerung-hagen-summons-vassals-instrument',
    );
  });

  it('collapses repeated non-alphanumerics into single hyphens', () => {
    expect(normalizeFactKey('foo___bar...baz!!!qux')).toBe('foo-bar-baz-qux');
  });

  it('preserves an already-clean slug verbatim', () => {
    expect(normalizeFactKey('mrs-dalloway-clarissa-party-guest-arrival-order')).toBe(
      'mrs-dalloway-clarissa-party-guest-arrival-order',
    );
  });

  it('caps length at FACT_KEY_MAX_CHARS without leaving a trailing hyphen', () => {
    const long = 'a'.repeat(50) + '-' + 'b'.repeat(50);
    const normalized = normalizeFactKey(long);
    expect(normalized).not.toBeNull();
    expect(normalized!.length).toBeLessThanOrEqual(FACT_KEY_MAX_CHARS);
    expect(normalized!.endsWith('-')).toBe(false);
  });

  it('produces the SAME key for two re-wordings of the same fact', () => {
    const a = normalizeFactKey('gotterdammerung-hagen-summons-vassals-instrument');
    const b = normalizeFactKey('Götterdämmerung Hagen summons vassals instrument');
    expect(a).toBe(b);
  });
});
