import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GameplayChatThread, type ChatMessage } from '@/components/play/GameplayChat';

// The catch-up live thread carries the same ⋯ report menu (AnsweredRowActions →
// ReportReasonSheet) the round recap has, on both the question card and the
// result card. The menu renders ONLY when the message carries a reportTarget —
// the Daily Five live thread builds its messages without one, so this stays a
// catch-up-only affordance until that surface opts in.

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

vi.mock('lucide-react', () => ({
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

function resultMessage(over: Partial<Extract<ChatMessage, { kind: 'result' }>>): ChatMessage {
  return {
    id: 'r1',
    kind: 'result',
    assignmentId: 'a1',
    questionText: 'Which composer wrote the Goldberg Variations?',
    result: 'wrong',
    submitted: 'Handel',
    correctAnswer: 'Bach',
    consolation: null,
    breadcrumb: null,
    copyVariant: 0,
    creatorName: null,
    ...over,
  };
}

describe('GameplayChat ⋯ report menu (catch-up thread)', () => {
  it('renders the menu button on a question card that carries a reportTarget', () => {
    const rendered = html([questionMessage({ reportTarget: { questionId: 'cq-1' } })]);
    expect(rendered).toContain('More actions');
  });

  it('renders the menu button even when the question has no attribution line', () => {
    const rendered = html([
      questionMessage({ subhead: null, creatorName: null, reportTarget: { questionId: 'cq-1' } }),
    ]);
    expect(rendered).toContain('More actions');
  });

  it('renders no menu on a question card without a reportTarget (Daily Five live thread)', () => {
    const rendered = html([questionMessage({ creatorName: 'Robyn' })]);
    expect(rendered).not.toContain('More actions');
  });

  it('renders the menu button on a result card that carries a reportTarget', () => {
    const rendered = html([resultMessage({ reportTarget: { generatedQuestionId: 'gq-1' } })]);
    expect(rendered).toContain('More actions');
  });

  it('renders no menu on a result card without a reportTarget', () => {
    const rendered = html([resultMessage({})]);
    expect(rendered).not.toContain('More actions');
  });
});
