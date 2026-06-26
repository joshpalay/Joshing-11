import { describe, expect, it } from 'vitest';

import { friendActivityToStreamItem, type StreamQuestion } from '@/lib/activity-stream';
import type { FriendActivityCard } from '@/lib/friend-activity';

// The From Friends card keeps the discovery, topic-attached voice ("…has been
// wandering through {Geography}…") even though grouping is now time/burst-based: the
// domains come from the burst's questions, not a single milestone domain.

function lineText(parts: { v?: string; name?: string }[]): string {
  return parts.map((p) => p.v ?? p.name ?? '').join('');
}

function card(over: Partial<FriendActivityCard> = {}): FriendActivityCard {
  return {
    id: 'burst:f-robyn:1',
    friendId: 'f-robyn',
    friendName: 'Robyn Hitchcock',
    friendFirstName: 'Robyn',
    context: 'feed',
    questionIds: ['q1', 'q2'],
    effectiveAt: new Date('2026-06-01T00:00:00Z'),
    heldSolo: false,
    ...over,
  };
}

function q(id: string, domain: string | null): StreamQuestion {
  return { questionId: id, text: `Q ${id}`, domain, priorResult: null };
}

describe('friendActivityToStreamItem copy', () => {
  it('names the burst domains in the discovery voice', () => {
    const item = friendActivityToStreamItem(card(), [q('q1', 'Geography'), q('q2', 'History')]);
    const text = lineText(item.line);
    expect(text).toContain('Robyn Hitchcock');
    expect(text).toContain('Geography');
    expect(text).toContain('History');
  });

  it('rolls up extra domains as "and N others"', () => {
    const item = friendActivityToStreamItem(card(), [
      q('q1', 'Geography'),
      q('q2', 'History'),
      q('q3', 'Music'),
      q('q4', 'Film'),
    ]);
    expect(lineText(item.line)).toContain('others');
  });

  it('falls back to a topic-less discovery line when no domain resolves', () => {
    const item = friendActivityToStreamItem(card(), [q('q1', null), q('q2', null)]);
    const text = lineText(item.line);
    // No domain named; still the observational, never-evaluative voice.
    expect(text).toMatch(/wandering somewhere new|finding new corners|following a thread/);
  });

  it('sorts on the card effectiveAt (chronological), not a prominence key', () => {
    const item = friendActivityToStreamItem(card(), [q('q1', 'Geography')]);
    expect(item.sortAt).toEqual(new Date('2026-06-01T00:00:00Z'));
    expect(item.icon).toBe('bundle');
    expect(item.expand?.kind).toBe('milestone');
  });
});
