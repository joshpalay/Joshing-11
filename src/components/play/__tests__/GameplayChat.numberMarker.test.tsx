import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GameplayChatThread, type ChatMessage } from '@/components/play/GameplayChat';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('lucide-react', () => ({
  Flag: () => <span aria-hidden="true" />,
  MoreHorizontal: () => <span aria-hidden="true" />,
  X: () => <span aria-hidden="true" />,
}));

function html(messages: ChatMessage[]) {
  return renderToStaticMarkup(<GameplayChatThread messages={messages} />);
}

function questionMessage(over: Partial<Extract<ChatMessage, { kind: 'question' }>>): ChatMessage {
  return {
    id: 'q1',
    kind: 'question',
    assignmentId: 'a1',
    questionText: 'Which composer wrote the Goldberg Variations?',
    creatorName: null,
    ...over,
  };
}

// B-GAMEPLAY-QUESTION-NUMBER-BOX-01: the gutter number marker above each card.
describe('GameplayChat question number marker', () => {
  it('renders core questions as `N.` with an accessible "Question N" label', () => {
    const rendered = html([questionMessage({ numberMarker: { value: 3, bonus: false } })]);
    expect(rendered).toContain('3.');
    expect(rendered).toContain('Question 3');
  });

  it('renders a bonus question as ✦ — never a numeral, never numbered 6 (D-GAMEPLAY-BONUS-GLYPH)', () => {
    // A bonus slot would carry a numeral `value` (e.g. slot_index 5 → 6), which
    // must be ignored: bonus is additive and never enters the denominator.
    const rendered = html([questionMessage({ numberMarker: { value: 6, bonus: true } })]);
    expect(rendered).toContain('✦');
    expect(rendered).toContain('Bonus question'); // accessible label
    // The marker must not leak the underlying core-style numeral.
    expect(rendered).not.toContain('6.');
  });

  it('renders no marker when numberMarker is absent (non-Daily-Five surfaces)', () => {
    const rendered = html([questionMessage({})]);
    expect(rendered).not.toContain('aria-label="Question');
    expect(rendered).not.toContain('aria-label="Bonus question"');
  });
});
