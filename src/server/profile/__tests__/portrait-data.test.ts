import { beforeEach, describe, expect, it, vi } from 'vitest';

const { questionFindManyMock, answerFindManyMock } = vi.hoisted(() => ({
  questionFindManyMock: vi.fn(),
  answerFindManyMock: vi.fn(),
}));

import { getPortraitData } from '@/server/profile/portrait';

describe('getPortraitData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('counts authored answered questions using only non-expired answers from other users', async () => {
    questionFindManyMock.mockResolvedValue([]);
    answerFindManyMock.mockResolvedValue([]);

    await getPortraitData('user-123');

    expect(questionFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({
          _count: {
            select: {
              answers: {
                where: {
                  result: { not: 'expired' },
                  user_id: { not: 'user-123' },
                },
              },
            },
          },
        }),
      })
    );
  });
});
