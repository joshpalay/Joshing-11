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

function resultMessage(over: Partial<Extract<ChatMessage, { kind: 'result' }>>): ChatMessage {
  return {
    id: 'r1',
    kind: 'result',
    assignmentId: 'a1',
    questionText: 'Which composer wrote the Goldberg Variations?',
    result: 'correct',
    submitted: 'Bach',
    correctAnswer: 'Johann Sebastian Bach',
    consolation: null,
    breadcrumb: null,
    copyVariant: 0,
    creatorName: null,
    ...over,
  };
}

describe('GameplayChat correct-answer treatment (D-5 live thread)', () => {
  it('shows the compact "Locked in." moment with the answer repeated and the common-ground beat', () => {
    const rendered = html([resultMessage({ result: 'correct' })]);
    expect(rendered).toContain('Locked in.');
    // The correct answer is repeated immediately, even on a right answer.
    expect(rendered).toContain('Johann Sebastian Bach');
    expect(rendered).toContain('common ground ++');
  });

  it('never renders both the explainer and the "Between us!" card after a correct answer', () => {
    const rendered = html([
      resultMessage({
        result: 'correct',
        explanation: 'A long background paragraph about why this answer matters.',
        insideJoke: 'Still your favourite Bach fact.',
        insideJokeKind: 'editorial',
      }),
    ]);
    // The light wink is kept; the longer explainer is deferred to review.
    expect(rendered).toContain('Still your favourite Bach fact.');
    expect(rendered).not.toContain('A long background paragraph about why this answer matters.');
  });

  it('keeps wrong-answer discovery: reveals the answer and shows the explainer when no wink exists', () => {
    const rendered = html([
      resultMessage({
        result: 'wrong',
        submitted: 'Handel',
        explanation: 'Bach wrote it for harpsichord around 1741.',
      }),
    ]);
    expect(rendered).toContain('Johann Sebastian Bach');
    expect(rendered).toContain('Bach wrote it for harpsichord around 1741.');
  });

  it('renders the answer-reveal card with a quiet label, the answer, and a plain explainer', () => {
    const rendered = html([
      resultMessage({
        result: 'gave_up',
        submitted: '',
        explanation: 'Angiosperms are divided into monocots and dicots.',
      }),
    ]);
    // Quiet label instead of the old editorial "For the record." intro.
    expect(rendered).toContain('The answer');
    expect(rendered).not.toContain('For the record.');
    expect(rendered).toContain('Johann Sebastian Bach');
    // Plain explainer, not wrapped in the old quote-block curly quotes.
    expect(rendered).toContain('Angiosperms are divided into monocots and dicots.');
    expect(rendered).not.toContain('“Angiosperms');
  });

  it('keeps the explainer and shows the "Between us!" wink below it on a discovery reveal', () => {
    const rendered = html([
      resultMessage({
        result: 'wrong',
        submitted: 'Handel',
        explanation: 'Bach wrote it around 1741.',
        insideJoke: 'Told you to study.',
        insideJokeKind: 'editorial',
      }),
    ]);
    expect(rendered).toContain('Bach wrote it around 1741.');
    expect(rendered).toContain('Told you to study.');
  });

  it('left-aligned cards share the single play-thread width token', () => {
    const rendered = html([
      { id: 'q1', kind: 'question', assignmentId: 'a1', questionText: 'Q?', creatorName: null },
      resultMessage({ result: 'correct' }),
    ]);
    // No card defines a one-off percentage width; every left-aligned card reads
    // from the shared token instead.
    expect(rendered).toContain('var(--play-thread-card-width)');
    expect(rendered).not.toContain('max-width:81%');
    expect(rendered).not.toContain('max-width:88%');
  });
});
