import { beforeAll, describe, expect, it } from 'vitest';

// llm.ts transitively imports @/server/db (via recordLlmUsage), which throws at
// module load without a connection string. The sanitizer is pure; a dummy URL +
// dynamic import (repo convention) keeps the unit pure.
let mod: typeof import('@/lib/llm');

beforeAll(async () => {
  process.env.DATABASE_URL ??= 'postgres://user:pass@localhost:5432/joshing_test';
  mod = await import('@/lib/llm');
});

type Params = Parameters<typeof mod.sanitizeParamsForModel>[0];
const base = (model: string, extra: Record<string, unknown> = {}) =>
  ({ model, max_tokens: 100, messages: [{ role: 'user', content: 'hi' }], ...extra }) as unknown as Params;
const rec = (p: Params) => mod.sanitizeParamsForModel(p) as unknown as Record<string, unknown>;

describe('modelRejectsSamplingParams', () => {
  it('is true for the Sonnet-5 / Opus-4.7+ / Fable line', () => {
    for (const m of ['claude-sonnet-5', 'claude-opus-4-7', 'claude-opus-4-8', 'claude-fable-5', 'claude-mythos-5']) {
      expect(mod.modelRejectsSamplingParams(m)).toBe(true);
    }
  });
  it('is false for Sonnet 4.6, Haiku 4.5, Opus 4.6', () => {
    for (const m of ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6']) {
      expect(mod.modelRejectsSamplingParams(m)).toBe(false);
    }
  });
});

describe('modelDefaultsThinkingOn', () => {
  it('is true only for Sonnet 5 / Mythos 5', () => {
    expect(mod.modelDefaultsThinkingOn('claude-sonnet-5')).toBe(true);
    expect(mod.modelDefaultsThinkingOn('claude-mythos-5')).toBe(true);
    expect(mod.modelDefaultsThinkingOn('claude-sonnet-4-6')).toBe(false);
    expect(mod.modelDefaultsThinkingOn('claude-opus-4-8')).toBe(false); // Opus 4.8 defaults thinking OFF
    expect(mod.modelDefaultsThinkingOn('claude-haiku-4-5-20251001')).toBe(false);
  });
});

describe('sanitizeParamsForModel', () => {
  it('leaves Sonnet 4.6 params untouched (same reference)', () => {
    const p = base('claude-sonnet-4-6', { temperature: 0.2 });
    expect(mod.sanitizeParamsForModel(p)).toBe(p);
  });

  it('leaves Haiku params untouched', () => {
    const p = base('claude-haiku-4-5-20251001', { temperature: 0 });
    expect(mod.sanitizeParamsForModel(p)).toBe(p);
  });

  it('strips temperature/top_p/top_k for Sonnet 5 and defaults thinking off', () => {
    const p = base('claude-sonnet-5', { temperature: 0.3, top_p: 0.9, top_k: 40 });
    const out = rec(p);
    expect(out.temperature).toBeUndefined();
    expect(out.top_p).toBeUndefined();
    expect(out.top_k).toBeUndefined();
    expect(out.thinking).toEqual({ type: 'disabled' });
    expect(out).not.toBe(p); // copied, original untouched
    expect((p as unknown as Record<string, unknown>).temperature).toBe(0.3);
  });

  it('strips sampling params for Opus 4.8 but does NOT force thinking (defaults off already)', () => {
    const p = base('claude-opus-4-8', { temperature: 0 });
    const out = rec(p);
    expect(out.temperature).toBeUndefined();
    expect(out.thinking).toBeUndefined();
  });

  it('respects a caller-specified thinking on Sonnet 5 (no override)', () => {
    const p = base('claude-sonnet-5', { temperature: 0.3, thinking: { type: 'adaptive' } });
    const out = rec(p);
    expect(out.thinking).toEqual({ type: 'adaptive' });
    expect(out.temperature).toBeUndefined();
  });

  it('does not add thinking:disabled for Fable (it rejects explicit disabled)', () => {
    const p = base('claude-fable-5', { temperature: 0.3 });
    const out = rec(p);
    expect(out.temperature).toBeUndefined();
    expect(out.thinking).toBeUndefined();
  });
});
