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

// B-DOMAIN-KEY-NORMALIZE-01 — pinned against the real fragmented rows the bank
// audit (finding ③b) surfaced, so the repair backfill and the lookup can never
// silently drift apart on the cases that actually cost money.
describe('domainKey — ③b bank-fragmentation regressions', () => {
  it('collapses the case / connector variants that fragmented real domains', () => {
    // Case-only variants that split into separate territories in the pool.
    expect(domainKey('American lesbian history')).toBe(domainKey('American Lesbian History'));
    expect(domainKey('Early 20th Century American History')).toBe(
      domainKey('Early 20th century American History'),
    );
    // "&" vs "and" spellings of the same domain.
    expect(domainKey('Food Chemistry & Cooking Science')).toBe(
      domainKey('Food Chemistry and Cooking Science'),
    );
    expect(domainKey('Human Anatomy & Physiology')).toBe(
      domainKey('Human Anatomy and Physiology'),
    );
    expect(domainKey('Parliamentary Procedure & Governance Rules')).toBe(
      domainKey('Parliamentary Procedure and Governance Rules'),
    );
  });

  it('keeps genuinely distinct bank displays apart (no false merge)', () => {
    // Bare title vs a more specific sibling, and sub-angle-decorated displays:
    // these are different rows in the pool and must not be merged by the fold.
    expect(domainKey('Star Trek')).not.toBe(domainKey('Star Trek: The Next Generation'));
    expect(domainKey('Shakespeare')).not.toBe(domainKey('Shakespearean Tragedy'));
    expect(domainKey('Bach')).not.toBe(domainKey("Bach's Fugal Technique"));
    expect(domainKey('Plant Biology & Botany')).not.toBe(domainKey('Plant Biology & Taxonomy'));
    expect(domainKey('Plant Biology & Botany')).not.toBe(
      domainKey('Plant Taxonomy & Classification'),
    );
    // Mrs. Dalloway and its sub-angle variants (word-bearing suffixes) stay
    // distinct — collapsing them would drop words. That is a categorization
    // concern upstream, not the fold's job.
    expect(domainKey('Mrs. Dalloway')).not.toBe(
      domainKey('Mrs. Dalloway – Character & Consciousness'),
    );
    expect(domainKey('Mrs. Dalloway')).not.toBe(
      domainKey('Narrative Technique & Time in Mrs. Dalloway'),
    );
  });

  it('documents the residuals the fold deliberately does NOT fix', () => {
    // Word-ORDER divergence (a request arriving under a reordered phrasing):
    // the fold never reorders words, so this stays a miss. Recovering it needs
    // request-side canonicalization upstream, tracked separately.
    expect(domainKey('The Legend of Zelda: Tears of the Kingdom')).not.toBe(
      domainKey('Tears of the Kingdom - the Legend of Zelda'),
    );
    // Period-spacing in initialisms (H3): unified by normalizeCanonicalSubcategory
    // at write time, not by the fold — so these keys still differ here.
    expect(domainKey('T.S. Eliot')).not.toBe(domainKey('T. S. Eliot'));
  });
});
