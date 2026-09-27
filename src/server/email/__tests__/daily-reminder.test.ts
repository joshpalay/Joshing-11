import { describe, expect, it } from 'vitest';

import { buildDailyReminderTemplate } from '@/server/email/templates/daily-reminder';
import { topicsForReminder } from '@/server/email/daily-reminder-data';
import type { QueueSlot } from '@/server/daily/types';

function slot(partial: Partial<QueueSlot>): QueueSlot {
  return {
    domain: 'Trivia',
    question_text: 'A question?',
    answered: false,
    ...partial,
  } as QueueSlot;
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
