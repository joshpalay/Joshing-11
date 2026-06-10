import { describe, expect, it } from 'vitest';

import { activityToStreamItem, momentToStreamItem } from '@/lib/activity-stream';
import type { ActivityItemView } from '@/server/db/queries/activity';
import type { LatelyMoment } from '@/server/db/queries/lately';

// D-FEED-GROUP3-01 — the "everything else" social stream. These pin the new
// expand-to-send-onward affordance (§4), the honest-authorship fields the
// reveal needs, and the full-sentence relationship copy (Appendix A pools).

function activity(
  type: ActivityItemView['type'],
  over: Partial<ActivityItemView> = {},
): ActivityItemView {
  return {
    id: 'act-1',
    userId: 'viewer-1',
    type,
    actorUserId: 'friend-1',
    referenceId: 'q-1',
    referenceType: 'question',
    read: false,
    createdAt: new Date('2026-06-01T12:00:00.000Z'),
    actor: { displayName: 'Robyn' },
    reference: {},
    ...over,
  } as unknown as ActivityItemView;
}

function moment(over: Partial<LatelyMoment> = {}): LatelyMoment {
  return {
    momentId: 'm-1',
    dir: 'they_got_you',
    friendId: 'friend-9',
    friendName: 'Sadie',
    friendFirstName: 'Sadie',
    questionId: 'q-1',
    questionText: 'Who is Bird?',
    category: 'Jazz',
    answeredAt: new Date('2026-06-01T12:00:00.000Z'),
    ...over,
  } as LatelyMoment;
}

const lineText = (item: { line: { t: string; v?: string; name?: string }[] }) =>
  item.line.map((p) => ('v' in p ? p.v : p.name)).join('');

describe('question_curated (saved) — expands to send the question onward (§4)', () => {
  it('carries a your_question expand with domain + honest authorship', () => {
    const item = activityToStreamItem(
      activity('question_curated', {
        type: 'question_curated',
        reference: {
          curatedQuestion: {
            questionText: 'What key is Giant Steps in?',
            domain: 'Jazz',
            authorName: null, // LLM-origin
            authorIsHouse: false,
          },
        },
      } as unknown as Partial<ActivityItemView>),
    );
    expect(item.relationship).toBe('saved');
    expect(item.expand?.kind).toBe('your_question');
    if (item.expand?.kind !== 'your_question') throw new Error('expected your_question');
    expect(item.expand.question.questionId).toBe('q-1');
    expect(item.expand.question.domain).toBe('Jazz');
    // null authorName is preserved (not coerced) so the reveal can mark it Generated.
    expect(item.expand.question.authorName).toBeNull();
    expect(item.expand.question.authorIsHouse).toBe(false);
  });

  it('does not expand when the saved question did not hydrate', () => {
    const item = activityToStreamItem(
      activity('question_curated', { type: 'question_curated', reference: {} } as unknown as Partial<ActivityItemView>),
    );
    expect(item.expand).toBeNull();
  });
});

describe('reaction_received (reacted) — keeps "got it" AND expands (§4)', () => {
  it('carries both the got-it action and a your_question expand with authorship', () => {
    const item = activityToStreamItem(
      activity('reaction_received', {
        type: 'reaction_received',
        referenceType: 'question_reaction',
        referenceId: 'rx-1',
        reference: {
          reaction: {
            id: 'rx-1',
            reactionLabel: 'Loved it',
            reactionEmoji: '❤️',
            customMessage: null,
            repliedAt: null,
            questionId: 'q-7',
            questionText: 'Who painted Guernica?',
            domain: 'Cubism',
            authorName: 'Joshing',
            authorIsHouse: true, // house/editorial
            submittedAnswer: null,
          },
        },
      } as unknown as Partial<ActivityItemView>),
    );
    expect(item.relationship).toBe('reacted');
    expect(item.action?.kind).toBe('reaction_got_it');
    expect(item.expand?.kind).toBe('your_question');
    if (item.expand?.kind !== 'your_question') throw new Error('expected your_question');
    expect(item.expand.question.questionId).toBe('q-7');
    expect(item.expand.question.authorIsHouse).toBe(true);
  });
});

describe('relationship copy pools (Appendix A) — full sentences, topic folded in', () => {
  it('got_you (they answered your question) reads as a full sentence, no echoed second line', () => {
    const item = momentToStreamItem(moment({ dir: 'they_got_you', category: 'Jazz' }));
    expect(item.relationship).toBe('got_you');
    // The friend is the social anchor; the topic is in the line, so secondLine clears.
    expect(item.line.some((p) => p.t === 'actor')).toBe(true);
    expect(item.secondLine).toBeNull();
    // Connection register only — never competition language.
    expect(lineText(item).toLowerCase()).not.toMatch(/beat|nailed|crushed|schooled|called/);
  });

  it('you_got (you answered their question) reads as a full sentence about the topic', () => {
    const item = momentToStreamItem(moment({ dir: 'you_got_them', category: 'Geography' }));
    expect(item.relationship).toBe('you_got');
    expect(item.line.some((p) => p.t === 'category')).toBe(true);
    expect(item.secondLine).toBeNull();
  });

  it('is stable: the same moment id always selects the same line', () => {
    const a = lineText(momentToStreamItem(moment({ momentId: 'm-stable', category: 'Jazz' })));
    const b = lineText(momentToStreamItem(moment({ momentId: 'm-stable', category: 'Jazz' })));
    expect(a).toBe(b);
  });
});
