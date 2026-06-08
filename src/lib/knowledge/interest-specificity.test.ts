import { describe, expect, it } from 'vitest';

import { STABLE_BROAD_CATEGORIES } from '@/lib/knowledge/broad-category';
import {
  assertSpecificInterest,
  isTooBroadInterest,
  TooBroadInterestError,
} from '@/lib/knowledge/interest-specificity';

describe('isTooBroadInterest', () => {
  it('rejects every top-level broad-category bucket', () => {
    for (const bucket of STABLE_BROAD_CATEGORIES) {
      expect(isTooBroadInterest(bucket)).toBe(true);
    }
  });

  it('rejects broad-category aliases and case/separator variants', () => {
    expect(isTooBroadInterest('Film & TV')).toBe(true);
    expect(isTooBroadInterest('television')).toBe(true);
    expect(isTooBroadInterest('world history')).toBe(true);
    expect(isTooBroadInterest('architecture and design')).toBe(true);
    expect(isTooBroadInterest('TECHNOLOGY')).toBe(true);
  });

  it('rejects generic catch-all fillers', () => {
    expect(isTooBroadInterest('general')).toBe(true);
    expect(isTooBroadInterest('general knowledge')).toBe(true);
    expect(isTooBroadInterest('trivia')).toBe(true);
    expect(isTooBroadInterest('other')).toBe(true);
    expect(isTooBroadInterest('miscellaneous')).toBe(true);
  });

  it('rejects empty/whitespace input', () => {
    expect(isTooBroadInterest('')).toBe(true);
    expect(isTooBroadInterest('   ')).toBe(true);
    expect(isTooBroadInterest(null)).toBe(true);
    expect(isTooBroadInterest(undefined)).toBe(true);
  });

  it('allows hyper-specific, passion-level topics', () => {
    expect(isTooBroadInterest('Byzantine Coinage')).toBe(false);
    expect(isTooBroadInterest('Late Tchaikovsky')).toBe(false);
    expect(isTooBroadInterest('James Joyce')).toBe(false);
    expect(isTooBroadInterest('Weimar-Era Cinema')).toBe(false);
    expect(isTooBroadInterest('90s Bollywood')).toBe(false);
    // Short but specific acronyms are not "broad".
    expect(isTooBroadInterest('AI alignment')).toBe(false);
  });
});

describe('assertSpecificInterest', () => {
  it('throws TooBroadInterestError for a bucket', () => {
    expect(() => assertSpecificInterest('Music')).toThrow(TooBroadInterestError);
  });

  it('does not throw for a specific topic', () => {
    expect(() => assertSpecificInterest('Delta Blues')).not.toThrow();
  });
});
