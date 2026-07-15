import { describe, expect, it } from 'vitest';

import { buildSections, type PortraitEntry } from '@/components/knowledge/PortraitCircles';
import type { TerritoryFrequency } from '@/lib/daily/territory-model';

function entry(overrides: Partial<PortraitEntry> & { canonicalSubcategory: string }): PortraitEntry {
  return {
    broadCategory: 'Literature',
    totalMasteryPoints: 10,
    tier: 'familiar',
    authoredAnsweredCount: 0,
    ...overrides,
  };
}

const FREQ: Record<string, TerritoryFrequency> = {
  'Shakespearean Tragedy': 'often',
  'Harry Potter Book 3': 'blue_moon',
  'Paradise Lost': 'sometimes',
  'Roman History': 'sometimes',
};

const frequencyFor = (name: string): TerritoryFrequency | null => FREQ[name] ?? null;

describe('buildSections frequency mode', () => {
  const entries = [
    entry({ canonicalSubcategory: 'Roman History', broadCategory: 'History', totalMasteryPoints: 5 }),
    entry({ canonicalSubcategory: 'Shakespearean Tragedy', totalMasteryPoints: 500, tier: 'solid' }),
    entry({ canonicalSubcategory: 'Paradise Lost', totalMasteryPoints: 80 }),
    entry({ canonicalSubcategory: 'Harry Potter Book 3', totalMasteryPoints: 30, tier: 'establishing' }),
    entry({ canonicalSubcategory: 'Unrotated Domain', totalMasteryPoints: 1 }),
  ];

  it('groups into rotation-depth order and skips empty buckets', () => {
    const sections = buildSections(entries, 'frequency', frequencyFor);
    expect(sections.map((s) => s.label)).toEqual(['Often', 'Sometimes', 'Blue Moon', 'Never']);
    expect(sections[0].entries.map((e) => e.canonicalSubcategory)).toEqual([
      'Shakespearean Tragedy',
    ]);
  });

  it('secondary-groups each bucket by category, heaviest category first (configure-page order)', () => {
    const sections = buildSections(entries, 'frequency', frequencyFor);
    const sometimes = sections.find((s) => s.label === 'Sometimes')!;
    expect(sometimes.groups!.map((g) => g.label)).toEqual(['Literature', 'History']);
    expect(sometimes.entries.map((e) => e.canonicalSubcategory)).toEqual([
      'Paradise Lost',
      'Roman History',
    ]);
  });

  it('keeps the catch-all category last and relabels it Other interests', () => {
    const sections = buildSections(
      [
        entry({ canonicalSubcategory: 'Misc Trivia', broadCategory: 'General Knowledge', totalMasteryPoints: 900 }),
        entry({ canonicalSubcategory: 'Paradise Lost', totalMasteryPoints: 80 }),
      ],
      'frequency',
      () => 'often',
    );
    expect(sections).toHaveLength(1);
    expect(sections[0].groups!.map((g) => g.label)).toEqual(['Literature', 'Other interests']);
  });

  it('sorts entries within a category group by mastery points descending', () => {
    const sections = buildSections(
      [
        entry({ canonicalSubcategory: 'Minor Work', totalMasteryPoints: 5 }),
        entry({ canonicalSubcategory: 'Major Work', totalMasteryPoints: 500 }),
      ],
      'frequency',
      () => 'often',
    );
    expect(sections[0].groups![0].entries.map((e) => e.canonicalSubcategory)).toEqual([
      'Major Work',
      'Minor Work',
    ]);
  });

  it('carries the zone frequency and shared copy for the configure-style header', () => {
    const sections = buildSections(entries, 'frequency', frequencyFor);
    expect(sections[0].frequency).toBe('often');
    expect(sections[0].copy).toBe('These show up most in your rounds.');
  });

  it('buckets a domain with no resolvable rotation under Never instead of dropping it', () => {
    const sections = buildSections(entries, 'frequency', frequencyFor);
    const never = sections.find((s) => s.label === 'Never')!;
    expect(never.entries.map((e) => e.canonicalSubcategory)).toEqual(['Unrotated Domain']);
  });

  it('treats every domain as Never when no resolver is provided', () => {
    const sections = buildSections(entries, 'frequency');
    expect(sections.map((s) => s.label)).toEqual(['Never']);
    expect(sections[0].entries).toHaveLength(entries.length);
  });

  it('leaves domain and mastery modes untouched by the resolver', () => {
    const byDomain = buildSections(entries, 'domain', frequencyFor);
    expect(byDomain[0].label).toBe('Literature');
    const byTier = buildSections(entries, 'mastery', frequencyFor);
    expect(byTier.map((s) => s.label)).toEqual(['Solid', 'Familiar', 'Establishing']);
  });
});
