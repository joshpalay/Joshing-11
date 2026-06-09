import { describe, expect, it } from 'vitest';

import {
  LOW_SIGNAL_COLLAPSE_CAP,
  activityToStreamItem,
  isLowSignalAmbient,
  mergeLowSignalLines,
  type StreamItem,
  type StreamLinePart,
} from '@/lib/activity-stream';
import type { ActivityItemView } from '@/server/db/queries/activity';

// D-FEED-TIER §3/§4: the two-tier visual classification (`signal`) and the
// low-signal collapse that folds adjacent ambient repeats onto one line.

function lowItem(id: string, line: StreamLinePart[], sortAt: Date, tier = 5): StreamItem {
  return {
    id,
    sortAt,
    tier,
    signal: 'low',
    homeEligible: true,
    line,
    secondLine: null,
    anchorId: null,
    action: null,
    icon: null,
    expand: null,
  };
}

function masteryActivity(): ActivityItemView {
  return {
    id: 'm-1',
    userId: 'viewer-1',
    type: 'friend_mastery',
    actorUserId: 'friend-1',
    referenceId: 'ref-1',
    referenceType: 'mastery_event',
    read: false,
    createdAt: new Date('2026-05-24T12:00:00.000Z'),
    actor: { displayName: 'Robyn' },
    reference: { masteryEvent: { tier: 'Fluent', domain: 'Jazz' } },
  } as unknown as ActivityItemView;
}

function answeredYourQuestionActivity(): ActivityItemView {
  return {
    id: 'f-1',
    userId: 'viewer-1',
    type: 'friend_answered_your_question',
    actorUserId: 'friend-1',
    referenceId: 'q-1',
    referenceType: 'question',
    read: false,
    createdAt: new Date('2026-05-24T12:00:00.000Z'),
    actor: { displayName: 'Robyn' },
    reference: {
      friendAnsweredQuestion: { result: 'incorrect', domain: 'Jazz', questionText: 'Who is Bird?' },
    },
  } as unknown as ActivityItemView;
}

describe('StreamItem signal tags', () => {
  it('tags friend_mastery as collapsible low-signal ambient', () => {
    const item = activityToStreamItem(masteryActivity());
    expect(item.signal).toBe('low');
    expect(isLowSignalAmbient(item)).toBe(true);
  });

  it('protects "answered your question" as a high-signal micro-tier event', () => {
    const item = activityToStreamItem(answeredYourQuestionActivity());
    expect(item.signal).toBe('micro');
    expect(isLowSignalAmbient(item)).toBe(false);
  });
});

describe('mergeLowSignalLines', () => {
  const a = lowItem('a', [{ t: 'text', v: 'Robyn got Sadie' }], new Date('2026-05-24T10:00:00Z'), 7);
  const b = lowItem('b', [{ t: 'text', v: 'Sadie on a streak' }], new Date('2026-05-24T09:00:00Z'), 5);
  const c = lowItem('c', [{ t: 'text', v: 'Theo reached Fluent' }], new Date('2026-05-24T08:00:00Z'), 6);

  it('returns the lone item unchanged for a run of one', () => {
    expect(mergeLowSignalLines([a])).toBe(a);
  });

  it('joins constituent lines with a middot and stays low-signal', () => {
    const merged = mergeLowSignalLines([a, b]);
    const text = merged.line.map((p) => ('v' in p ? p.v : '')).join('');
    expect(text).toBe('Robyn got Sadie · Sadie on a streak');
    expect(merged.signal).toBe('low');
    expect(merged.icon).toBeNull();
    expect(merged.expand).toBeNull();
  });

  it('inherits the newest sortAt and the lowest tier', () => {
    const merged = mergeLowSignalLines([a, b, c]);
    expect(merged.sortAt).toEqual(a.sortAt); // newest of the three
    expect(merged.tier).toBe(5); // min(7,5,6)
    expect(merged.id).toBe('collapsed-a');
  });

  it('caps shown lines and rolls the remainder into a "+N more" tail', () => {
    const extra = lowItem('d', [{ t: 'text', v: 'Mara reached Adept' }], new Date('2026-05-24T07:00:00Z'));
    const merged = mergeLowSignalLines([a, b, c, extra]);
    const text = merged.line.map((p) => ('v' in p ? p.v : '')).join('');
    expect(LOW_SIGNAL_COLLAPSE_CAP).toBe(3);
    expect(text).toContain('· +1 more');
    expect(text).not.toContain('Mara reached Adept');
  });
});
