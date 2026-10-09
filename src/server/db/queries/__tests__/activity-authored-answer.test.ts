import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  creatorId: 'viewer' as string | null,
  rows: [] as Record<string, unknown>[],
  questionSelects: [] as unknown[],
}));
vi.mock('@/server/db/queries/user-blocks', () => ({ blockedIdsAmong: async () => new Set() }));
vi.mock('@/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/db')>();
  return {
    ...actual,
    db: {
      select(selection: unknown) {
        let table: unknown;
        const result = () =>
          table === actual.activityItems
            ? fixture.rows
            : table === actual.users
              ? [{ id: 'chiann', displayName: 'Chiann' }]
              : table === actual.questions
                ? [
                    {
                      id: 'norman',
                      creatorId: fixture.creatorId,
                      source: 'house_authored',
                      questionText: 'Which language?',
                      canonicalSubcategory: 'History',
                      broadCategory: 'history',
                    },
                  ]
                : [];
        const chain = {
          from(value: unknown) {
            table = value;
            if (table === actual.questions) fixture.questionSelects.push(selection);
            return chain;
          },
          where() {
            return chain;
          },
          leftJoin() {
            return chain;
          },
          orderBy() {
            return chain;
          },
          limit() {
            return Promise.resolve(result());
          },
          then(resolve: (value: unknown) => unknown) {
            return Promise.resolve(result()).then(resolve);
          },
        };
        return chain;
      },
    },
  };
});

import { getActivitiesForUser } from '@/server/db/queries/activity';
import { activityToStreamItem } from '@/lib/activity-stream';

beforeEach(() => {
  fixture.creatorId = 'viewer';
  fixture.questionSelects = [];
  fixture.rows = ['one', 'two'].map((id) => ({
    id,
    userId: 'viewer',
    actorUserId: 'chiann',
    type: 'niche_match_answered_your_question',
    referenceId: 'norman',
    referenceType: 'question',
    read: false,
    createdAt: new Date(),
    deletedAt: null,
  }));
});

describe('canonical authored-answer evidence during activity hydration', () => {
  it('reads actual authorship in the existing single question batch for multiple events', async () => {
    const items = await getActivitiesForUser('viewer');
    expect(items).toHaveLength(2);
    expect(items.every((item) => item.reference.nicheMatch?.viewerIsAuthor)).toBe(true);
    expect(items.every((item) => activityToStreamItem(item).authoredAnswer)).toBe(true);
    const nicheBatches = fixture.questionSelects.filter(
      (selection) =>
        selection &&
        typeof selection === 'object' &&
        'creatorId' in selection &&
        !('source' in selection),
    );
    expect(nicheBatches).toHaveLength(1);
    expect(nicheBatches[0]).toHaveProperty('creatorId');
    expect(items.map((item) => item.id)).toEqual(['one', 'two']);
    expect(items.every((item) => item.read === false)).toBe(true);
  });
  it.each(['another-author', null])(
    'does not feature a forwarded or creator-less question (%s)',
    async (creatorId) => {
      fixture.creatorId = creatorId;
      const items = await getActivitiesForUser('viewer');
      expect(items.every((item) => item.reference.nicheMatch?.viewerIsAuthor === false)).toBe(true);
      expect(items.every((item) => activityToStreamItem(item).authoredAnswer === false)).toBe(true);
    },
  );
  it('does not feature the viewer answering their own question', async () => {
    fixture.rows = [{ ...fixture.rows[0], actorUserId: 'viewer' }];
    const items = await getActivitiesForUser('viewer');
    expect(items[0].reference.nicheMatch?.viewerIsAuthor).toBe(false);
  });
});
