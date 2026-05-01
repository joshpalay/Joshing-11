import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  redirectMock,
  notFoundMock,
  getCurrentUserMock,
  userFindUniqueMock,
  getFriendPortraitDataMock,
  getMasteryDataMock,
  personalMasteryPageMock,
} = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  notFoundMock: vi.fn(),
  getCurrentUserMock: vi.fn(),
  userFindUniqueMock: vi.fn(),
  getFriendPortraitDataMock: vi.fn(),
  getMasteryDataMock: vi.fn(),
  personalMasteryPageMock: vi.fn(() => <div data-testid="personal-mastery-page" />),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
  notFound: notFoundMock,
}));

vi.mock('@/lib/auth/user', () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: userFindUniqueMock,
    },
  },
}));

vi.mock('@/server/profile/friend', () => ({
  getFriendPortraitData: getFriendPortraitDataMock,
}));

vi.mock('@/server/profile/portrait', () => ({
  getMasteryData: getMasteryDataMock,
}));

vi.mock('@/components/profile/PersonalMasteryPage', () => ({
  PersonalMasteryPage: personalMasteryPageMock,
}));

import ProfilePage from '@/app/profile/page';
import UserPortraitPage from '@/app/users/[userId]/page';

describe('B5 page route auth + redirect gates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    redirectMock.mockImplementation(() => {
      throw new Error('REDIRECT_SIGNAL');
    });
    notFoundMock.mockImplementation(() => {
      throw new Error('NOT_FOUND_SIGNAL');
    });
  });

  it('redirects anonymous users to /login for own profile page', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);

    await expect(
      ProfilePage({
        searchParams: Promise.resolve({}),
      }),
    ).rejects.toThrow('REDIRECT_SIGNAL');

    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('redirects anonymous users to /login for /users/[userId]', async () => {
    getCurrentUserMock.mockResolvedValueOnce(null);

    await expect(UserPortraitPage({ params: Promise.resolve({ userId: 'u-2' }) })).rejects.toThrow('REDIRECT_SIGNAL');

    expect(redirectMock).toHaveBeenCalledWith('/login');
  });

  it('redirects /users/[userId] to /profile for self visits', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ id: 'u-1', display_name: 'Josh Example' });

    await expect(UserPortraitPage({ params: Promise.resolve({ userId: 'u-1' }) })).rejects.toThrow('REDIRECT_SIGNAL');

    expect(redirectMock).toHaveBeenCalledWith('/profile');
    expect(userFindUniqueMock).not.toHaveBeenCalled();
  });

  it('404s for private portrait owner visibility', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ id: 'viewer-1', display_name: 'Viewer' });
    userFindUniqueMock.mockResolvedValueOnce({ id: 'u-2', display_name: 'Maya Quill', portrait_visibility: 'private' });

    await expect(UserPortraitPage({ params: Promise.resolve({ userId: 'u-2' }) })).rejects.toThrow('NOT_FOUND_SIGNAL');

    expect(notFoundMock).toHaveBeenCalled();
    expect(getFriendPortraitDataMock).not.toHaveBeenCalled();
    expect(getMasteryDataMock).not.toHaveBeenCalled();
  });

  it('renders friend portrait page data for visible profiles', async () => {
    getCurrentUserMock.mockResolvedValueOnce({ id: 'viewer-1', display_name: 'Viewer' });
    userFindUniqueMock.mockResolvedValueOnce({ id: 'u-2', display_name: 'Maya Quill', portrait_visibility: 'public' });
    getFriendPortraitDataMock.mockResolvedValueOnce({ categories: [], max_declared_score: 0, max_proven_score: 0, visitor_unexplored: [] });
    getMasteryDataMock.mockResolvedValueOnce([]);

    const result = await UserPortraitPage({ params: Promise.resolve({ userId: 'u-2' }) });

    expect(getFriendPortraitDataMock).toHaveBeenCalledWith('u-2', 'viewer-1');
    expect(getMasteryDataMock).toHaveBeenCalledWith('u-2');
    expect(result).toMatchObject({
      props: expect.objectContaining({
        userId: 'u-2',
        mode: 'friend',
        displayName: 'Maya Quill',
        firstName: 'Maya',
      }),
    });
  });
});
