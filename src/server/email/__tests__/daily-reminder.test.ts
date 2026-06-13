import { describe, expect, it } from 'vitest';

import { buildDailyReminderTemplate } from '@/server/email/templates/daily-reminder';
import { formatActivityForEmail, topicsForReminder } from '@/server/email/daily-reminder-data';
import type { ActivityItemView } from '@/server/db/queries/activity';
import type { QueueSlot } from '@/server/daily/types';

function slot(partial: Partial<QueueSlot>): QueueSlot {
  return {
    domain: 'Trivia',
    question_text: 'A question?',
    answered: false,
    ...partial,
  } as QueueSlot;
}

function activity(partial: Partial<ActivityItemView>): ActivityItemView {
  return {
    id: 'a1',
    userId: 'u1',
    actorUserId: 'actor',
    referenceId: null,
    referenceType: null,
    read: false,
    createdAt: new Date(),
    type: 'friend_answered_your_question',
    actor: { displayName: 'Robyn' },
    reference: {},
    ...partial,
  } as ActivityItemView;
}

describe('topicsForReminder', () => {
  it('returns unanswered, non-skipped domains in order, deduped, capped at 5', () => {
    const slots = [
      slot({ domain: 'Virginia Woolf' }),
      slot({ domain: 'Beethoven', answered: true }),
      slot({ domain: 'The Progressive Era', skipped: true }),
      slot({ domain: 'Film Noir' }),
      slot({ domain: 'Film Noir' }), // duplicate
      slot({ domain: 'The Space Race' }),
      slot({ domain: 'Jazz' }),
      slot({ domain: 'Cartography' }),
      slot({ domain: 'Mycology' }),
    ];
    expect(topicsForReminder(slots)).toEqual([
      'Virginia Woolf',
      'Film Noir',
      'The Space Race',
      'Jazz',
      'Cartography',
    ]);
  });

  it('trims and drops empty domains', () => {
    expect(topicsForReminder([slot({ domain: '  Beethoven  ' }), slot({ domain: '   ' })])).toEqual([
      'Beethoven',
    ]);
  });

  it('returns an empty array when there is nothing playable', () => {
    expect(topicsForReminder([slot({ answered: true }), slot({ skipped: true })])).toEqual([]);
  });
});

describe('formatActivityForEmail', () => {
  it('renders one plain, people-first sentence per supported type', () => {
    const views = [
      activity({ id: '1', type: 'friend_answered_your_question', actor: { displayName: 'Robyn' } }),
      activity({ id: '2', type: 'reaction_received', actor: { displayName: 'Sadie' } }),
      activity({ id: '3', type: 'received_direct_question', actor: { displayName: 'Josh' } }),
    ];
    expect(formatActivityForEmail(views)).toEqual([
      'Robyn answered one of your questions.',
      'Sadie reacted to your answer.',
      'Josh sent you a question.',
    ]);
  });

  it('folds the domain into mastery and promotion lines', () => {
    const views = [
      activity({
        id: '1',
        type: 'friend_mastery',
        actor: { displayName: 'Mara' },
        reference: { masteryEvent: { domain: 'Film Noir', tier: null } },
      }),
      activity({
        id: '2',
        type: 'declared_promoted',
        actor: { displayName: 'Theo' },
        reference: { declaredPromoted: { domain: 'The Space Race', questionText: 'q' } },
      }),
    ];
    expect(formatActivityForEmail(views)).toEqual([
      'Mara went deep on Film Noir.',
      'Theo opened The Space Race.',
    ]);
  });

  it('skips viewer-own broadcasts and unknown types', () => {
    const views = [
      activity({ id: '1', type: 'authored_question_shared' }),
      activity({ id: '2', type: 'ceremony_ready' }),
    ];
    expect(formatActivityForEmail(views)).toEqual([]);
  });

  it('falls back to "A friend" when the actor is missing', () => {
    expect(
      formatActivityForEmail([activity({ type: 'reaction_received', actor: null })]),
    ).toEqual(['A friend reacted to your answer.']);
  });

  it('caps the output at three items', () => {
    const views = Array.from({ length: 5 }, (_, i) =>
      activity({ id: String(i), type: 'received_direct_question', actor: { displayName: `P${i}` } }),
    );
    expect(formatActivityForEmail(views)).toHaveLength(3);
  });
});

describe('buildDailyReminderTemplate', () => {
  const base = {
    dailyUrl: 'https://joshing.app/daily',
    interestsUrl: 'https://joshing.app/daily/setup',
    topics: ['Virginia Woolf', 'Beethoven', 'Film Noir'],
  };

  it('rotates the subject across the four approved lines', () => {
    const subject = buildDailyReminderTemplate(base).subject;
    expect([
      'Your Daily Five is ready',
      'Today’s five are waiting',
      'Five questions for today',
      'Your Daily Five',
    ]).toContain(subject);
  });

  it('includes the preheader, both links, and the topic labels', () => {
    const { html } = buildDailyReminderTemplate(base);
    expect(html).toContain('Five questions from the knowledge you share.');
    expect(html).toContain('https://joshing.app/daily');
    expect(html).toContain('https://joshing.app/daily/setup');
    expect(html).toContain('Not quite your mix? Update your interests →');
    expect(html).toContain('Virginia Woolf');
    expect(html).toContain('Play today’s five');
  });

  it('falls back to a single line when there are no topics', () => {
    const { html, text } = buildDailyReminderTemplate({ ...base, topics: [] });
    expect(html).toContain('Today’s five are ready.');
    expect(text).toContain('Today’s five are ready.');
  });

  it('omits Meanwhile when there is no activity and renders it when present', () => {
    const without = buildDailyReminderTemplate(base);
    expect(without.html).not.toContain('Meanwhile');

    const withActivity = buildDailyReminderTemplate({
      ...base,
      activity: ['Robyn answered one of your questions.'],
    });
    expect(withActivity.html).toContain('Meanwhile');
    expect(withActivity.html).toContain('Robyn answered one of your questions.');
  });

  it('omits A Glimpse without a teaser and shows a truncated, answer-free preview with one', () => {
    expect(buildDailyReminderTemplate(base).html).not.toContain('A glimpse');

    const long = 'x'.repeat(200);
    const { html } = buildDailyReminderTemplate({
      ...base,
      teaser: { questionText: long, domain: 'Film Noir' },
    });
    expect(html).toContain('A glimpse');
    expect(html).toContain('One of today’s five.');
    expect(html).toContain('…'); // elegantly truncated
    expect(html).not.toContain(long); // never the full text
  });
});
