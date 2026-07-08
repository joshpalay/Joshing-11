import { describe, expect, it } from 'vitest';

import { buildDomainFragmentationEmailTemplate } from '@/server/email/templates/domain-fragmentation';
import type { FragmentationPair, NarrowDomain } from '@/server/db/queries/domain-fragmentation';

const pair = (over: Partial<FragmentationPair> = {}): FragmentationPair => ({
  domainA: 'Spy School',
  depthA: 9,
  domainB: 'Evil Spy School',
  depthB: 4,
  similarity: 0.62,
  ...over,
});

const narrow = (over: Partial<NarrowDomain> = {}): NarrowDomain => ({
  domain: 'Shakespearean Tragedy',
  depth: 20,
  topAngle: 'Hamlet',
  topAngleCount: 14,
  topAngleShare: 0.7,
  distinctAngles: 5,
  ...over,
});

const build = (pairs: FragmentationPair[], narrowDomains: NarrowDomain[] = []) =>
  buildDomainFragmentationEmailTemplate({ pairs, narrowDomains });

describe('buildDomainFragmentationEmailTemplate', () => {
  it('renders an all-clear message when both sections are empty', () => {
    const out = build([], []);
    expect(out.subject).toMatch(/nothing to look at/i);
    expect(out.text).toMatch(/no near-duplicate/i);
    expect(out.html).toContain('<p>');
  });

  it('summarizes both section counts in the subject', () => {
    expect(build([pair()]).subject).toMatch(/1 merge cluster\b/);
    expect(build([pair(), pair()]).subject).toMatch(/2 merge clusters\b/);
    expect(build([], [narrow()]).subject).toMatch(/1 breadth flag\b/);
    expect(build([pair()], [narrow()]).subject).toMatch(/1 merge cluster \+ 1 breadth flag/);
  });

  it('lists each merge pair with depths and a rounded similarity percentage', () => {
    const out = build([pair()]);
    expect(out.text).toContain('Spy School (9)');
    expect(out.text).toContain('Evil Spy School (4)');
    expect(out.text).toContain('62%');
    expect(out.html).toContain('62%');
  });

  it('lists each breadth flag with depth, facet count, dominant facet and share', () => {
    const out = build([], [narrow()]);
    expect(out.text).toContain('Shakespearean Tragedy');
    expect(out.text).toContain('20 q');
    expect(out.text).toContain('5 facets');
    expect(out.text).toContain('70%');
    expect(out.text).toContain('Hamlet');
    expect(out.html).toContain('70%');
  });

  it('links the merge section to the review dashboard when a reviewUrl is given', () => {
    const out = buildDomainFragmentationEmailTemplate({
      pairs: [pair()],
      narrowDomains: [],
      reviewUrl: 'https://joshing.app/admin/domains',
    });
    expect(out.html).toContain('href="https://joshing.app/admin/domains"');
    expect(out.text).toContain('https://joshing.app/admin/domains');
    // The old manual "reply and I’ll merge" loop is gone.
    expect(out.text).not.toMatch(/reply and I/i);
  });

  it('omits the dashboard CTA when no reviewUrl is provided', () => {
    const out = build([pair()]);
    expect(out.html).not.toContain('/admin/domains');
    expect(out.text).not.toContain('/admin/domains');
  });

  it('HTML-escapes domain and facet names so a stray "&"/"<" cannot break markup', () => {
    const out = build(
      [pair({ domainA: 'Rock & Roll', domainB: 'Rock <Roll>' })],
      [narrow({ topAngle: 'Q&A <facet>' })],
    );
    expect(out.html).toContain('Rock &amp; Roll');
    expect(out.html).toContain('Rock &lt;Roll&gt;');
    expect(out.html).toContain('Q&amp;A &lt;facet&gt;');
    expect(out.text).toContain('Rock & Roll');
  });
});
