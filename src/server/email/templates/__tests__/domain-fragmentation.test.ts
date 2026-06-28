import { describe, expect, it } from 'vitest';

import { buildDomainFragmentationEmailTemplate } from '@/server/email/templates/domain-fragmentation';
import type { FragmentationPair } from '@/server/db/queries/domain-fragmentation';

const pair = (over: Partial<FragmentationPair> = {}): FragmentationPair => ({
  domainA: 'Spy School',
  depthA: 9,
  domainB: 'Evil Spy School',
  depthB: 4,
  similarity: 0.62,
  ...over,
});

describe('buildDomainFragmentationEmailTemplate', () => {
  it('renders an all-clear message when there are no candidates', () => {
    const out = buildDomainFragmentationEmailTemplate([]);
    expect(out.subject).toMatch(/nothing to look at/i);
    expect(out.text).toMatch(/No near-duplicate/i);
    expect(out.html).toContain('<p>');
  });

  it('pluralizes the subject by candidate count', () => {
    expect(buildDomainFragmentationEmailTemplate([pair()]).subject).toMatch(/1 cluster\b/);
    expect(buildDomainFragmentationEmailTemplate([pair(), pair()]).subject).toMatch(/2 clusters\b/);
  });

  it('lists each pair with depths and a rounded similarity percentage', () => {
    const out = buildDomainFragmentationEmailTemplate([pair()]);
    expect(out.text).toContain('Spy School (9)');
    expect(out.text).toContain('Evil Spy School (4)');
    expect(out.text).toContain('62%');
    expect(out.html).toContain('62%');
  });

  it('HTML-escapes domain names so a stray "&"/"<" cannot break the markup', () => {
    const out = buildDomainFragmentationEmailTemplate([
      pair({ domainA: 'Rock & Roll', domainB: 'Rock <Roll>' }),
    ]);
    expect(out.html).toContain('Rock &amp; Roll');
    expect(out.html).toContain('Rock &lt;Roll&gt;');
    // Raw text keeps the literal characters.
    expect(out.text).toContain('Rock & Roll');
  });
});
