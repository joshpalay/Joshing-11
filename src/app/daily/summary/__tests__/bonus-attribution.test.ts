import { describe, expect, it } from 'vitest';

import { bonusKnowledgeLine } from '@/app/daily/summary/page';

describe('bonusKnowledgeLine (recap attribution register, D-F4)', () => {
  it('uses the singular presence-framed register (never "by {Name}")', () => {
    expect(bonusKnowledgeLine({ name: 'Ada', extraCount: 0 })).toBe('from Ada’s knowledge');
  });

  it('uses the extra-count form when other friends surface the domain', () => {
    expect(bonusKnowledgeLine({ name: 'Ada', extraCount: 2 })).toBe(
      'from Ada + others’ knowledge',
    );
  });

  it('reduces a full name to its first name (mirrors GameplayChat)', () => {
    expect(bonusKnowledgeLine({ name: 'Ada Lovelace', extraCount: 0 })).toBe(
      'from Ada’s knowledge',
    );
  });

  it('never frames the friend as author/answerer', () => {
    const line = bonusKnowledgeLine({ name: 'Ada', extraCount: 1 });
    expect(line).not.toMatch(/\bby\b|wrote|answered/i);
    expect(line.startsWith('from ')).toBe(true);
  });
});
