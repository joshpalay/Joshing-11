import { describe, expect, it } from 'vitest';

import { domainKey, foldDomainPunctuation } from '@/lib/knowledge/domain-key';

describe('foldDomainPunctuation', () => {
  it('folds curly/modifier apostrophes to ASCII', () => {
    expect(foldDomainPunctuation('90’s')).toBe("90's");
    expect(foldDomainPunctuation('90ʼs')).toBe("90's");
  });
});

describe('domainKey', () => {
  it('lowercases, trims, and collapses whitespace (baseline behaviour)', () => {
    expect(domainKey('  Mrs   Dalloway  ')).toBe('mrs dalloway');
  });

  it('folds typographic apostrophes so declared/answered spellings merge', () => {
    expect(domainKey('90’s Hip Hop')).toBe(domainKey("90's Hip Hop"));
  });

  it('folds a colon separator so the same topic does not fragment', () => {
    expect(domainKey('Star Trek: The Next Generation')).toBe(
      domainKey('Star Trek The Next Generation'),
    );
    expect(domainKey('Star Trek:The Next Generation')).toBe(
      domainKey('Star Trek The Next Generation'),
    );
  });

  it('folds en/em dashes and a spaced-hyphen separator', () => {
    const target = domainKey('Star Trek The Next Generation');
    expect(domainKey('Star Trek – The Next Generation')).toBe(target);
    expect(domainKey('Star Trek — The Next Generation')).toBe(target);
    expect(domainKey('Star Trek - The Next Generation')).toBe(target);
  });

  it('treats "&" and "and" as the same connector', () => {
    expect(domainKey('Polyphony & Western Music Theory')).toBe(
      domainKey('Polyphony and Western Music Theory'),
    );
    expect(domainKey('Crime&Punishment')).toBe(domainKey('Crime and Punishment'));
  });

  it('never drops a word — distinct topics stay distinct', () => {
    // A subtitle that adds a word must NOT collide with the bare title.
    expect(domainKey('Alien: Covenant')).not.toBe(domainKey('Alien'));
    expect(domainKey('Henry IV, Part 2')).not.toBe(domainKey('Henry IV'));
  });

  it('leaves in-word hyphens intact (no false merges)', () => {
    expect(domainKey('D-Day Invasion')).toBe('d-day invasion');
    expect(domainKey('Ancient Roman History and Republic-to-Empire Transition')).toBe(
      'ancient roman history and republic-to-empire transition',
    );
  });
});
