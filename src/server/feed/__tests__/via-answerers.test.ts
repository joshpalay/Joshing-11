import { describe, expect, it } from 'vitest';

import {
  groupAnswerersByQuestion,
  type ViaAnswererRow,
} from '@/server/feed/via-answerers';

// B-VIA-ATTRIBUTION-01: invariants on the pure grouping/ordering helper —
// set completeness, recency order, self-exclusion, follow-gating, per-friend
// dedup. DB-free; the DB join is exercised separately, this asserts the shape.

const VIEWER = 'viewer-1';

function row(
  questionId: string,
  userId: string,
  displayName: string | null,
  answeredAtIso: string,
): ViaAnswererRow {
  return { questionId, userId, displayName, answeredAt: new Date(answeredAtIso) };
}

function followSet(...ids: string[]): Set<string> {
  return new Set(ids);
}

describe('groupAnswerersByQuestion', () => {
  it('returns the COMPLETE set per question (never hides a name behind a count)', () => {
    const rows = [
      row('q1', 'a', 'Sadie', '2026-06-01T10:00:00Z'),
      row('q1', 'b', 'Robyn', '2026-06-02T10:00:00Z'),
      row('q1', 'c', 'Allan', '2026-06-03T10:00:00Z'),
      row('q1', 'd', 'Mara', '2026-06-04T10:00:00Z'),
      row('q1', 'e', 'Tom', '2026-06-05T10:00:00Z'),
    ];
    const grouped = groupAnswerersByQuestion(rows, {
      viewerUserId: VIEWER,
      approvedFollowIds: followSet('a', 'b', 'c', 'd', 'e'),
    });
    const set = grouped.get('q1');
    expect(set).toHaveLength(5);
    expect(set?.map((a) => a.displayName).sort()).toEqual(
      ['Allan', 'Mara', 'Robyn', 'Sadie', 'Tom'],
    );
  });

  it('orders each set most-recent-first (lead = newest)', () => {
    const rows = [
      row('q1', 'a', 'Older', '2026-06-01T10:00:00Z'),
      row('q1', 'b', 'Newest', '2026-06-05T10:00:00Z'),
      row('q1', 'c', 'Middle', '2026-06-03T10:00:00Z'),
    ];
    const set = groupAnswerersByQuestion(rows, {
      viewerUserId: VIEWER,
      approvedFollowIds: followSet('a', 'b', 'c'),
    }).get('q1');
    expect(set?.map((a) => a.displayName)).toEqual(['Newest', 'Middle', 'Older']);
  });

  it('excludes the viewer from their own Via set (self-exclusion)', () => {
    const rows = [
      row('q1', VIEWER, 'Me', '2026-06-05T10:00:00Z'),
      row('q1', 'a', 'Friend', '2026-06-01T10:00:00Z'),
    ];
    const set = groupAnswerersByQuestion(rows, {
      viewerUserId: VIEWER,
      approvedFollowIds: followSet(VIEWER, 'a'),
    }).get('q1');
    expect(set).toHaveLength(1);
    expect(set?.[0]?.userId).toBe('a');
  });

  it('drops answerers the viewer does not follow (follow-gating)', () => {
    const rows = [
      row('q1', 'followed', 'Followed', '2026-06-01T10:00:00Z'),
      row('q1', 'stranger', 'Stranger', '2026-06-05T10:00:00Z'),
    ];
    const set = groupAnswerersByQuestion(rows, {
      viewerUserId: VIEWER,
      approvedFollowIds: followSet('followed'),
    }).get('q1');
    expect(set).toHaveLength(1);
    expect(set?.[0]?.displayName).toBe('Followed');
  });

  it('dedups a friend who answered twice, keyed to their most-recent answer', () => {
    const rows = [
      row('q1', 'a', 'Sadie', '2026-06-01T10:00:00Z'),
      row('q1', 'a', 'Sadie', '2026-06-09T10:00:00Z'),
      row('q1', 'b', 'Robyn', '2026-06-05T10:00:00Z'),
    ];
    const set = groupAnswerersByQuestion(rows, {
      viewerUserId: VIEWER,
      approvedFollowIds: followSet('a', 'b'),
    }).get('q1');
    expect(set).toHaveLength(2);
    // Sadie's latest answer (Jun 9) now leads over Robyn (Jun 5).
    expect(set?.map((a) => a.displayName)).toEqual(['Sadie', 'Robyn']);
    expect(set?.[0]?.answeredAt).toBe(new Date('2026-06-09T10:00:00Z').toISOString());
  });

  it('groups independently per question', () => {
    const rows = [
      row('q1', 'a', 'Sadie', '2026-06-01T10:00:00Z'),
      row('q2', 'b', 'Robyn', '2026-06-02T10:00:00Z'),
    ];
    const grouped = groupAnswerersByQuestion(rows, {
      viewerUserId: VIEWER,
      approvedFollowIds: followSet('a', 'b'),
    });
    expect(grouped.get('q1')?.map((a) => a.displayName)).toEqual(['Sadie']);
    expect(grouped.get('q2')?.map((a) => a.displayName)).toEqual(['Robyn']);
  });

  it('builds a profile href and falls back to a neutral name', () => {
    const rows = [row('q1', 'user-x', '  ', '2026-06-01T10:00:00Z')];
    const set = groupAnswerersByQuestion(rows, {
      viewerUserId: VIEWER,
      approvedFollowIds: followSet('user-x'),
    }).get('q1');
    expect(set?.[0]?.href).toBe('/users/user-x');
    expect(set?.[0]?.displayName).toBe('A friend');
  });
});
