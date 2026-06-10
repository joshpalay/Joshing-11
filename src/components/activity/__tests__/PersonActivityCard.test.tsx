import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { StreamItem, StreamLinePart } from '@/lib/activity-stream';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock('@/components/SendQuestionDrawer', () => ({ SendQuestionDrawer: () => null }));
vi.mock('@/app/activities/FriendRequestActions', () => ({ FriendRequestActions: () => null }));
vi.mock('@/app/activities/ReactionGotItButton', () => ({ ReactionGotItButton: () => null }));

import { PersonActivityCard } from '@/components/activity/PersonActivityCard';

const txt = (v: string): StreamLinePart => ({ t: 'text', v });
const act = (name: string): StreamLinePart => ({ t: 'actor', name, userId: 'robyn' });
const cat = (v: string): StreamLinePart => ({ t: 'category', v });

function row(over: Partial<StreamItem> & { id: string; line: StreamLinePart[] }): StreamItem {
  return {
    sortAt: new Date('2026-06-01T00:00:00Z'),
    tier: 3,
    friendId: 'robyn',
    homeEligible: true,
    secondLine: null,
    anchorId: null,
    action: null,
    expand: null,
    icon: 'diamond',
    ...over,
  };
}

function render(rows: StreamItem[]) {
  return renderToStaticMarkup(
    <PersonActivityCard friendId="robyn" rows={rows} timestampFor={() => '1w ago'} />,
  );
}

describe('PersonActivityCard — rolled-up cluster', () => {
  it('rolls a friend up by direction with the name said once and topics listed', () => {
    const html = render([
      row({ id: 'g1', relationship: 'you_got', topic: 'Plant Taxonomy', line: [txt('You got '), act('Robyn'), txt(' on '), cat('Plant Taxonomy')] }),
      row({ id: 'g2', relationship: 'you_got', topic: 'Color References', line: [txt('You got '), act('Robyn'), txt(' on '), cat('Color References')] }),
      row({ id: 't1', relationship: 'got_you', topic: 'Rent', line: [act('Robyn'), txt(' got your question')] }),
    ]);
    expect(html).toContain('You &amp; Robyn');
    expect(html).toContain('got Robyn — Plant Taxonomy, Color References');
    expect(html).toContain('Robyn got yours — Rent');
  });

  it('folds a convergence to its predicate, dropping the "You and {Name}" echo', () => {
    const html = render([
      row({ id: 't1', relationship: 'got_you', topic: 'Rent', line: [act('Robyn'), txt(' got your question')] }),
      row({
        id: 'c1',
        relationship: 'convergence',
        line: [txt('You and '), act('Robyn'), txt(' keep landing in the same place')],
      }),
    ]);
    expect(html).toContain('keep landing in the same place');
    // The echoed "You and Robyn …" full caption is not repeated as its own line.
    expect(html).not.toContain('You and Robyn keep landing');
  });
});
