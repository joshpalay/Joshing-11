import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={typeof href === 'string' ? href : String(href)} {...props}>
      {children}
    </a>
  ),
}));

import FriendsHubPage from '@/components/FriendsHubPage';
import FriendsList from '@/components/FriendsList';

const forbiddenGamificationCopy =
  /leaderboard|ranking|ranked|score|points?|percent|%|timer|streak|hurry|urgent/i;

const forbiddenRelationshipCopy =
  /Following|Followers|Who can follow you|Make public|Follow requests|Mutual|Follows you/i;

describe('Friends page QA surface', () => {
  it('centers the page on inviting someone without leaderboard/ranking mechanics', () => {
    const html = renderToStaticMarkup(<FriendsHubPage />);

    expect(html).toContain('Friends');
    expect(html).toContain('Who shares your world?');
    expect(html).toContain('Invite Someone');
    expect(html).not.toContain('Add friend');
    expect(html).not.toMatch(forbiddenGamificationCopy);
    expect(html).not.toMatch(forbiddenRelationshipCopy);
  });

  it('removes social-network tabs and profile controls from the friends list shell', () => {
    const html = renderToStaticMarkup(<FriendsList />);

    expect(html).toContain('Loading friends…');
    expect(html).not.toContain('Following');
    expect(html).not.toContain('Followers');
    expect(html).not.toContain('Pending');
    expect(html).not.toContain('Who can follow you');
    expect(html).not.toMatch(forbiddenGamificationCopy);
    expect(html).not.toMatch(forbiddenRelationshipCopy);
  });
});
