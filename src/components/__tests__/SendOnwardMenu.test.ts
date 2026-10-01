import { describe, expect, it } from 'vitest';

import { buildTextOnwardMessage } from '@/components/SendOnwardMenu';

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
