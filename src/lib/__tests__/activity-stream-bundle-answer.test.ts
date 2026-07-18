import { describe, expect, it } from 'vitest';

import { bundleAnswerToStreamItem } from '@/lib/activity-stream';
import { LATELY_TIER } from '@/lib/lately';
import type { BundleAnswerMoment } from '@/server/db/queries/lately';

// A bundle answer is the viewer answering a creator-less (LLM) question met
// through a friend's From Friends bundle. It must surface as a quiet Recent
// activity one-liner (previously it left no trace at all once the bundle was
// exhausted) — WITHOUT ever claiming the friend authored the question.

function moment(over: Partial<BundleAnswerMoment> = {}): BundleAnswerMoment {
  return {
    momentId: 'me-1',
    friendId: 'f-david',
    friendName: 'David',
    friendFirstName: 'David',
    questionId: 'q-1',
    questionText:
      'In Rosencrantz and Guildenstern Are Dead, which classic Shakespeare play does the action take place within and around?',
    category: 'Tom Stoppard Plays',
    answeredAt: new Date('2026-07-17T23:15:05Z'),
    ...over,
  };
}

function lineText(parts: { v?: string; name?: string }[]): string {
  return parts.map((p) => p.v ?? p.name ?? '').join('');
}

describe('bundleAnswerToStreamItem', () => {
  it('names the friend and the topic in the shared-territory voice', () => {
    const item = bundleAnswerToStreamItem(moment());
    const text = lineText(item.line);
    expect(text).toContain('David');
    expect(text).toContain('Tom Stoppard Plays');
    // Never an authorship claim: these lines describe shared territory, not
    // "{friend}'s question".
    expect(text).not.toMatch(/David's/);
  });

  it('links the friend as an actor part and the topic as a serif category part', () => {
    const item = bundleAnswerToStreamItem(moment());
    expect(item.line).toContainEqual({ t: 'actor', name: 'David', userId: 'f-david' });
    expect(item.line).toContainEqual({ t: 'category', v: 'Tom Stoppard Plays' });
  });

  it('is quiet texture: OTHER tier, not home-headline-eligible, diamond mark', () => {
    const item = bundleAnswerToStreamItem(moment());
    expect(item.tier).toBe(LATELY_TIER.OTHER);
    expect(item.homeEligible).toBe(false);
    expect(item.icon).toBe('diamond');
    expect(item.sortAt).toEqual(new Date('2026-07-17T23:15:05Z'));
  });

  it('carries the played_along relationship (never you_got) for person-card roll-ups', () => {
    const item = bundleAnswerToStreamItem(moment());
    expect(item.relationship).toBe('played_along');
    expect(item.friendId).toBe('f-david');
    expect(item.topic).toBe('Tom Stoppard Plays');
  });

  it('expands to a send-onward reveal with honest LLM attribution', () => {
    const item = bundleAnswerToStreamItem(moment());
    expect(item.expand).toEqual({
      kind: 'your_question',
      question: {
        questionId: 'q-1',
        text: moment().questionText,
        domain: 'Tom Stoppard Plays',
        priorResult: 'correct',
        // null (not undefined): the reveal must render the LLM attribution
        // label, never imply the friend wrote it.
        authorName: null,
      },
    });
  });

  it('prefixes the stream id so it can never collide with a moment on the same event', () => {
    const item = bundleAnswerToStreamItem(moment());
    expect(item.id).toBe('bundle-answer-me-1');
  });

  it('varies the line by event id but stays deterministic per event', () => {
    const a1 = lineText(bundleAnswerToStreamItem(moment({ momentId: 'a' })).line);
    const a2 = lineText(bundleAnswerToStreamItem(moment({ momentId: 'a' })).line);
    expect(a1).toBe(a2);
  });
});
