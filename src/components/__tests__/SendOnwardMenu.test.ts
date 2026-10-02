import { describe, expect, it } from 'vitest';

import { buildTextOnwardMessage, pickInviteLinkUrl } from '@/components/SendOnwardMenu';

describe('buildTextOnwardMessage', () => {
  it('carries the question, the answer, and a link to play', () => {
    expect(
      buildTextOnwardMessage({ text: ' Who drowns in Hamlet? ', answer: 'Ophelia ' }, 'https://joshing.app'),
    ).toBe('Did you know?\n\nWho drowns in Hamlet?\n\nOphelia\n\nPlay on Joshing: https://joshing.app');
  });

  it('never invents an answer when none is held', () => {
    expect(buildTextOnwardMessage({ text: 'Who drowns in Hamlet?', answer: null }, 'https://joshing.app')).toBe(
      'Who drowns in Hamlet?\n\nPlay on Joshing: https://joshing.app',
    );
  });
});

describe('pickInviteLinkUrl', () => {
  const links = [
    { url: 'https://j.app/u/duo/aaa', categories: [{ label: 'Renaissance Florence' }] },
    { url: 'https://j.app/u/duo/bbb', categories: [{ label: 'Final Fantasy' }, { label: 'Breaking Bad' }] },
  ];

  it("prefers the link that carries the question's topic", () => {
    expect(pickInviteLinkUrl(links, 'breaking bad')).toBe('https://j.app/u/duo/bbb');
  });

  it('falls back to the first link, and to null with no links', () => {
    expect(pickInviteLinkUrl(links, 'Catch-22')).toBe('https://j.app/u/duo/aaa');
    expect(pickInviteLinkUrl([], 'Catch-22')).toBeNull();
  });
});
