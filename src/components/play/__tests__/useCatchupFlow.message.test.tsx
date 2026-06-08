import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GameplayChatThread, type ChatMessage } from '@/components/play/GameplayChat';
import {
  buildCatchupResultMessage,
  type CatchupAnswerResponse,
  type CatchupQueueItem,
} from '@/components/play/useCatchupFlow';
import { INSIDE_JOKE_LABELS } from '@/lib/questions-types';

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

function catchupItem(over: Partial<CatchupQueueItem> = {}): CatchupQueueItem {
  return {
    dailyQueueItemId: 'queue-1:0',
    questionId: 'q-1',
    questionText: 'Which composer wrote the Goldberg Variations?',
    correctAnswer: 'Bach',
    alternateAnswers: [],
    explanation: null,
    domain: 'music',
    domainDisplayName: 'Music',
    queueDate: '2026-06-01',
    queueAge: 1,
    wasSkipped: false,
    expiresAt: '2026-06-03T00:00:00.000Z',
    ...over,
  };
}

// These mirror the JSON shape the catch-up answer route returns (lines 364-366,
// 524-526): the server has already resolved creatorNote and gated the aside
// (insideJoke / insideJokeKind) through selectInsideJokeForViewer.
function answerResponse(over: Partial<CatchupAnswerResponse> = {}): CatchupAnswerResponse {
  return {
    result: 'correct',
    isCorrect: true,
    correctAnswer: 'Bach',
    ...over,
  };
}

describe('useCatchupFlow result message (B-9: commentary + aside reach the render layer)', () => {
  it('carries the server creatorNote, insideJoke, and insideJokeKind onto the built message', () => {
    // This is the exact regression guard: the shipped hook set creatorName /
    // creatorIsHouse but dropped these three fields, so the message it built
    // never carried them and the player saw nothing. If the wiring is reverted,
    // these expectations fail.
    const message = buildCatchupResultMessage({
      id: 'r-1',
      item: catchupItem({ authorName: 'Dana' }),
      data: answerResponse({
        creatorNote: 'I lost a bet over this in 2019.',
        insideJoke: 'You still owe me a coffee.',
        insideJokeKind: 'relational',
      }),
      isCorrect: true,
      submittedAnswer: 'Bach',
      pointsAwarded: 4,
    });

    expect(message.kind).toBe('result');
    expect(message.authorNote).toBe('I lost a bet over this in 2019.');
    expect(message.insideJoke).toBe('You still owe me a coffee.');
    expect(message.insideJokeKind).toBe('relational');
  });

  it('shows only the lighter relational aside in the live thread and defers the creator note to review when both exist', () => {
    const rendered = html([
      buildCatchupResultMessage({
        id: 'r-1',
        item: catchupItem({ authorName: 'Dana', authorIsHouse: false }),
        data: answerResponse({
          creatorNote: 'I lost a bet over this in 2019.',
          insideJoke: 'You still owe me a coffee.',
          insideJokeKind: 'relational',
        }),
        isCorrect: true,
        submittedAnswer: 'Bach',
        pointsAwarded: 4,
      }),
    ]);

    // The "Between us!" wink is preferred in the live thread (D-5): one reflection.
    expect(rendered).toContain('You still owe me a coffee.');
    expect(rendered).toContain(INSIDE_JOKE_LABELS.relational);
    expect(rendered).not.toContain(INSIDE_JOKE_LABELS.editorial);
    // The fuller creator note is deferred to the End of Session Review, so it
    // never appears (or repeats) alongside the aside in the live thread.
    expect(rendered).not.toContain('I lost a bet over this in 2019.');
    expect(rendered).not.toContain('Why Dana asked');
  });

  it('prefers the editorial aside in the live thread and defers the editor\'s note to review when both exist', () => {
    const rendered = html([
      buildCatchupResultMessage({
        id: 'r-1',
        item: catchupItem({ authorName: 'Joshing', authorIsHouse: true }),
        data: answerResponse({
          creatorNote: 'A favourite of the editorial desk.',
          insideJoke: 'One for the archive.',
          insideJokeKind: 'editorial',
        }),
        isCorrect: true,
        submittedAnswer: 'Bach',
        pointsAwarded: 4,
      }),
    ]);

    // The editorial wink shows; the longer editor's note is deferred to review.
    expect(rendered).toContain('One for the archive.');
    expect(rendered).toContain(INSIDE_JOKE_LABELS.editorial);
    expect(rendered).not.toContain('A favourite of the editorial desk.');
    // House commentary is editorial, never relational — no "Why {name} asked".
    expect(rendered).not.toContain('Why Joshing asked');
    // The editor's-note card is deferred to review, so its label is absent too.
    expect(rendered).not.toContain('Editor');
  });

  it('still surfaces the creator note in the live thread when there is no aside to prefer', () => {
    const rendered = html([
      buildCatchupResultMessage({
        id: 'r-1',
        item: catchupItem({ authorName: 'Dana', authorIsHouse: false }),
        data: answerResponse({ creatorNote: 'I lost a bet over this in 2019.', insideJoke: null, insideJokeKind: null }),
        isCorrect: true,
        submittedAnswer: 'Bach',
        pointsAwarded: 4,
      }),
    ]);

    // With no lighter wink available, the single reflection falls back to the note.
    expect(rendered).toContain('I lost a bet over this in 2019.');
    expect(rendered).toContain('Why Dana asked');
  });

  it('renders no aside when the server gated it out (selectInsideJokeForViewer returned null)', () => {
    const rendered = html([
      buildCatchupResultMessage({
        id: 'r-1',
        item: catchupItem({ authorName: 'Dana' }),
        data: answerResponse({ creatorNote: null, insideJoke: null, insideJokeKind: null }),
        isCorrect: true,
        submittedAnswer: 'Bach',
        pointsAwarded: 4,
      }),
    ]);

    // Under-exposure check: a hidden aside must not leak either label.
    expect(rendered).not.toContain(INSIDE_JOKE_LABELS.relational);
    expect(rendered).not.toContain(INSIDE_JOKE_LABELS.editorial);
  });
});
