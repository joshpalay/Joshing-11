import { describe, expect, it } from 'vitest';
import { estimateCostUsd } from './pricing';

describe('Haiku 5.5 pricing', () => {
  it('uses the short-prompt rates for Cassian-sized requests', () => {
    expect(estimateCostUsd('claude-haiku-5-5', {
      inputTokens: 10_000, outputTokens: 1_000, cacheReadTokens: 0, cacheCreateTokens: 0,
    }).usd).toBeCloseTo(0.0015);
  });

  it('uses the long-prompt tier above 100k including cached input', () => {
    expect(estimateCostUsd('claude-haiku-5-5', {
      inputTokens: 2_000, outputTokens: 1_000, cacheReadTokens: 99_000, cacheCreateTokens: 0,
    }).usd).toBeCloseTo(0.00845);
  });
});

describe('current Sonnet 5.5 pricing', () => {
  it('uses $2 input, $10 output, and $0.10 cache reads per million', () => {
    expect(estimateCostUsd('claude-sonnet-5-5', {
      inputTokens: 1_000_000, outputTokens: 1_000_000,
      cacheReadTokens: 1_000_000, cacheCreateTokens: 0,
    }).usd).toBeCloseTo(12.1);
  });
});
