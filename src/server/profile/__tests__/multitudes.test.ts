import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MasteryTier } from '@prisma/client';

const createMock = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: createMock };
  },
}));

import {
  buildMultitudesCacheKey,
  generateMultitudesCopy,
  getCachedMultitudesCopy,
  invalidateMultitudesCacheForUser,
  setCachedMultitudesCopy,
} from '@/server/profile/multitudes';

describe('multitudes cache and fallback behavior', () => {
  beforeEach(() => {
    invalidateMultitudesCacheForUser('user-1');
    createMock.mockReset();
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('builds cache key with sorted canonical subcategories', () => {
    const a = buildMultitudesCacheKey('user-1', ['B', 'A']);
    const b = buildMultitudesCacheKey('user-1', ['A', 'B']);
    expect(a).toBe(b);
  });

  it('invalidates all cache entries for a user', () => {
    setCachedMultitudesCopy(buildMultitudesCacheKey('user-1', ['A']), 'one');
    setCachedMultitudesCopy(buildMultitudesCacheKey('user-1', ['B']), 'two');

    invalidateMultitudesCacheForUser('user-1');
    expect(getCachedMultitudesCopy(buildMultitudesCacheKey('user-1', ['A']))).toBeNull();
    expect(getCachedMultitudesCopy(buildMultitudesCacheKey('user-1', ['B']))).toBeNull();
  });

  it('uses fallback copy when anthropic key is unavailable', async () => {
    const res = await generateMultitudesCopy({
      top_categories: [
        { canonical_subcategory: 'Late Bach', tier: 'mastery' as MasteryTier },
        { canonical_subcategory: 'Weimar Cinema', tier: 'solid' as MasteryTier },
      ],
      portrait_state: 'developing',
    });

    expect(res.usedFallback).toBe(true);
    expect(res.copy).toBe('Late Bach · Weimar Cinema');
  });

  it('does not truncate generated copy at 25 words', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const text = Array.from({ length: 25 }, (_, i) => `word${i + 1}`).join(' ');
    createMock.mockResolvedValue({
      content: [{ type: 'text', text }],
    });

    const res = await generateMultitudesCopy({
      top_categories: [{ canonical_subcategory: 'Late Bach', tier: 'mastery' as MasteryTier }],
      portrait_state: 'rich',
    });

    expect(res.copy).toBe(text);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not truncate generated copy at 30 words', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const text = Array.from({ length: 30 }, (_, i) => `word${i + 1}`).join(' ');
    createMock.mockResolvedValue({
      content: [{ type: 'text', text }],
    });

    const res = await generateMultitudesCopy({
      top_categories: [{ canonical_subcategory: 'Late Bach', tier: 'mastery' as MasteryTier }],
      portrait_state: 'rich',
    });

    expect(res.copy).toBe(text);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('does not truncate when whitespace wraps a 30-word response', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const base = Array.from({ length: 30 }, (_, i) => `word${i + 1}`).join(' ');
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: `   ${base}   ` }],
    });

    const res = await generateMultitudesCopy({
      top_categories: [{ canonical_subcategory: 'Late Bach', tier: 'mastery' as MasteryTier }],
      portrait_state: 'rich',
    });

    expect(res.copy).toBe(base);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('truncates generated copy at 31 words to 25 words with ellipsis and logs', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    const text = Array.from({ length: 31 }, (_, i) => `word${i + 1}`).join(' ');
    createMock.mockResolvedValue({
      content: [{ type: 'text', text }],
    });

    const res = await generateMultitudesCopy({
      top_categories: [{ canonical_subcategory: 'Late Bach', tier: 'mastery' as MasteryTier }],
      portrait_state: 'rich',
    });

    expect(res.copy.split(/\s+/)).toHaveLength(25);
    expect(res.copy.endsWith('…')).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      '[multitudes] generated copy exceeded 30 words; truncated to 25 words',
      { originalWordCount: 31, truncatedWordCount: 25 },
    );
    warnSpy.mockRestore();
  });
});
