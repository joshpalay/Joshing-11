import { describe, expect, it } from 'vitest';

import { buildWeeklyFriendsTemplate } from '@/server/email/templates/weekly-friends';

const base = {
  activityUrl: 'https://joshing.app/activities',
  settingsUrl: 'https://joshing.app/users/me#notifications',
  unsubscribeUrl: 'https://joshing.app/unsubscribe?token=t',
  sections: [
    { heading: 'Your questions', lines: ['Neil answered 3 and got 2.'] },
    { heading: 'New faces', lines: ['You & <Zed> are now friends.'] },
  ],
};

describe('buildWeeklyFriendsTemplate', () => {
  it('renders every section in both the text and the html', () => {
    const { subject, text, html } = buildWeeklyFriendsTemplate(base);
    expect(subject).toBe('Your week with friends on Joshing');
    expect(text).toContain('YOUR QUESTIONS\nNeil answered 3 and got 2.');
    expect(text).toContain('NEW FACES');
    expect(html).toContain('Neil answered 3 and got 2.');
    expect(html).toContain('Your questions');
  });

  it('escapes names in the html', () => {
    const { html } = buildWeeklyFriendsTemplate(base);
    expect(html).toContain('You &amp; &lt;Zed&gt; are now friends.');
    expect(html).not.toContain('<Zed>');
  });

  it('offers both "turn this one off" and a full unsubscribe', () => {
    const { text, html } = buildWeeklyFriendsTemplate(base);
    expect(text).toContain(`Turn this one off: ${base.settingsUrl}`);
    expect(text).toContain(`Stop all Joshing email: ${base.unsubscribeUrl}`);
    expect(html).toContain(base.settingsUrl);
    expect(html).toContain(base.unsubscribeUrl);
  });

  it('drops blank lines and empty sections', () => {
    const { text } = buildWeeklyFriendsTemplate({
      ...base,
      sections: [
        { heading: 'Your questions', lines: ['  '] },
        { heading: 'New faces', lines: ['You and Zed are now friends.'] },
      ],
    });
    expect(text).not.toContain('YOUR QUESTIONS');
    expect(text).toContain('NEW FACES');
  });
});
