import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ActivitySubcopy } from '@/app/activities/page';
import type { ActivityItemView } from '@/server/db/queries/activity';

vi.mock('@/app/activities/CreatorNoteReadButton', () => ({
  CreatorNoteReadButton: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock('@/app/activities/MarkActivitiesRead', () => ({ MarkActivitiesRead: () => null }));
vi.mock('@/app/activities/ReactionGotItButton', () => ({ ReactionGotItButton: () => null }));
vi.mock('@/server/auth/session', () => ({ getSession: vi.fn() }));
vi.mock('@/server/db/queries/activity', () => ({ getActivitiesForUser: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

function creatorNoteActivity(submittedAnswer: string | null): ActivityItemView {
  return {
    id: 'activity-1',
    userId: 'recipient-1',
    type: 'creator_note_received',
    actorUserId: 'author-1',
    referenceId: 'note-1',
    referenceType: 'creator_note',
    read: false,
    createdAt: new Date('2026-05-01T12:00:00.000Z'),
    actor: { displayName: 'Avery' },
    reference: {
      creatorNote: {
        id: 'note-1',
        questionText: 'Who wrote the song?',
        correctAnswer: 'Prince',
        submittedAnswer,
        noteText: 'Tiny correction, big groove.',
        deliveredAt: null,
      },
    },
  };
}

describe('creator-note submitted-answer rendering', () => {
  it('renders the saved submitted answer for new Feed misses', () => {
    const html = renderToStaticMarkup(<ActivitySubcopy item={creatorNoteActivity('Morris Day')} />);

    expect(html).toContain('Morris Day');
    expect(html).not.toContain('Your answer was not saved.');
  });

  it('renders the historical fallback when a Feed miss has no saved answer', () => {
    const html = renderToStaticMarkup(<ActivitySubcopy item={creatorNoteActivity(null)} />);

    expect(html).toContain('Your answer was not saved.');
  });
});
