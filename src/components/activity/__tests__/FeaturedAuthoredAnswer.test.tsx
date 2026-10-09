import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { activityToStreamItem, momentToStreamItem, type StreamItem } from '@/lib/activity-stream';
import type { ActivityItemView } from '@/server/db/queries/activity';
import type { LatelyMoment } from '@/server/db/queries/lately';

vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props}>{children}</a>
  ),
}));
vi.mock('@/components/activity/InlineAnswerFlow', () => ({ InlineAnswerFlow: () => null }));
vi.mock('@/components/SendQuestionDrawer', () => ({ SendQuestionDrawer: () => null }));
vi.mock('@/app/activities/FriendRequestActions', () => ({ FriendRequestActions: () => null }));
vi.mock('@/app/activities/ReactionGotItButton', () => ({ ReactionGotItButton: () => null }));

import { ActivityStreamItem } from '@/components/activity/ActivityStreamItem';

const moment: LatelyMoment = {
  momentId: 'correct-authored',
  dir: 'they_got_you',
  friendId: 'chiann',
  friendName: 'Chiann Alexandra',
  friendFirstName: 'Chiann',
  questionId: 'norman',
  category: 'Post-Conquest Medieval English Court Culture',
  questionText: 'Which language became the language of the English royal court?',
  gameTitle: 'Joshing',
  answeredAt: new Date('2026-10-08T10:00:00Z'),
};
function authored(): StreamItem {
  const item = momentToStreamItem(moment);
  if (item.expand?.kind === 'your_question') item.expand.question.correctAnswer = 'Norman French';
  return item;
}
function html(item: StreamItem, enabled = true) {
  return renderToStaticMarkup(
    <ActivityStreamItem
      item={item}
      timestamp="now"
      showTimestamp={false}
      elevated
      featureAuthoredAnswers={enabled}
    />,
  );
}
function raw(result: 'correct' | 'incorrect'): ActivityItemView {
  return {
    id: 'raw',
    userId: 'viewer',
    type: 'friend_answered_your_question',
    actorUserId: 'chiann',
    referenceId: 'forwarded',
    referenceType: 'question',
    read: false,
    createdAt: moment.answeredAt,
    actor: { displayName: 'Chiann' },
    reference: {
      friendAnsweredQuestion: {
        domain: 'History',
        questionText: 'Someone else wrote this.',
        result,
        authorName: 'Another author',
        authorIsHouse: false,
      },
    },
  } as ActivityItemView;
}

describe('Home featured authored answers', () => {
  it('opens a verified authored success immediately with the canonical answer and existing links', () => {
    const result = html(authored());
    expect(result).toContain('authored-answer-card');
    expect(result).toContain('YOUR QUESTION, ANSWERED');
    expect(result).toContain('Chiann Alexandra');
    expect(result).toContain('knew the answer.');
    expect(result).toContain(moment.category);
    expect(result).toContain(moment.questionText);
    expect(result).toContain('Norman French');
    expect(result).toContain('aria-expanded="true"');
    expect(result).toContain('aria-controls=');
    expect(result).toContain('href="/users/chiann"');
    expect(result).toContain('Send to a friend');
    expect(result).not.toContain('box-shadow');
  });

  it('preserves the default compact, collapsed presentation on the Activities page', () => {
    const result = html(authored(), false);
    expect(result).not.toContain('authored-answer-card');
    expect(result).not.toContain(moment.questionText);
    expect(result).toContain('aria-expanded="false"');
  });

  it.each(['correct', 'incorrect'] as const)(
    'never features a raw %s friend-answer record as proof of authorship',
    (result) => {
      const item = activityToStreamItem(raw(result));
      expect(item.relationship).toBe('got_you');
      expect(item.authoredAnswer).not.toBe(true);
      expect(html(item)).not.toContain('YOUR QUESTION, ANSWERED');
      expect(html(item)).not.toContain('knew the answer.');
      expect(html(item)).toContain('aria-expanded="false"');
    },
  );

  it('does not feature the viewer answering another author’s question', () => {
    const item = momentToStreamItem({ ...moment, dir: 'you_got_them' });
    expect(item.authoredAnswer).toBe(false);
    expect(html(item)).not.toContain('authored-answer-card');
  });

  it('requires a canonical viewer-author check for author-side niche discovery and retains discovery', () => {
    const source = {
      ...raw('correct'),
      type: 'niche_match_answered_your_question',
      reference: {
        nicheMatch: { domain: 'History', questionText: 'Which language?', viewerIsAuthor: true },
      },
    } as ActivityItemView;
    const item = activityToStreamItem(source);
    expect(item.authoredAnswer).toBe(true);
    expect(html(item)).toContain('YOUR QUESTION, ANSWERED');
    expect(html(item)).toContain('DISCOVER');
    expect(
      activityToStreamItem({
        ...source,
        reference: { nicheMatch: { ...source.reference.nicheMatch!, viewerIsAuthor: false } },
      }).authoredAnswer,
    ).toBe(false);
  });

  it('handles absent optional data without empty answer labels or send controls', () => {
    const item = authored();
    if (item.expand?.kind !== 'your_question') throw new Error('expected question');
    item.expand.question.correctAnswer = null;
    item.expand.question.domain = null;
    item.line = [];
    const result = html(item);
    expect(result).toContain('A friend');
    expect(result).toContain(moment.questionText);
    expect(result).not.toContain('Send to a friend');
    expect(result).not.toContain('>Answer<');
    expect(html({ ...item, expand: null })).not.toContain('authored-answer-card');
    item.expand.question.text = '';
    expect(html(item)).not.toContain('authored-answer-card');
  });

  it('retains long names, categories, and questions without clamping', () => {
    const item = authored();
    const name = 'Chiann Alexandra Montgomery-Sutherland';
    const domain = moment.category.repeat(4);
    const question = moment.questionText.repeat(8);
    item.line = [{ t: 'actor', name, userId: 'chiann' }];
    if (item.expand?.kind !== 'your_question') throw new Error('expected question');
    item.expand.question.domain = domain;
    item.expand.question.text = question;
    const result = html(item);
    expect(result).toContain(name);
    expect(result).toContain(domain);
    expect(result).toContain(question);
    expect(result).not.toContain('line-clamp');
    expect(result).toContain('overflow-wrap:anywhere');
  });
});
