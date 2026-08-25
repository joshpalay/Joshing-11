import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GameplayChatThread, type ChatMessage } from '@/components/play/GameplayChat';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
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

/**
 * B-BONUS-OFFER-01. The regression these guard is the one Neil (and Carolyn, and
 * Todderick) hit: with no "continue" affordance on a bonus slot, the durable
 * category opt-out was the most forward-looking control on screen, and new
 * players tapped it to proceed. See drizzle/0131_bonus_offer_seen_at.sql.
 */
describe('friend-bonus interstitial', () => {
  it('names friends’ categories and states the points/five split', () => {
    const markup = html([
      {
        id: 'bonus-offer',
        kind: 'bonus_offer',
        available: 2,
        onAccept: () => {},
        onDecline: () => {},
      },
    ]);

    expect(markup).toContain('2 more questions from friends');
    expect(markup).toContain('categories');
    // Must not repeat the old "Counts toward your score" line, which contradicted
    // D-F3 (bonus is additive and never enters the spoken X/Y).
    expect(markup).toContain('not part of your five');
    expect(markup).toContain('Keep going');
    expect(markup).toContain('No thanks');
  });

  it('singularizes a lone bonus question', () => {
    const markup = html([
      {
        id: 'bonus-offer',
        kind: 'bonus_offer',
        available: 1,
        onAccept: () => {},
        onDecline: () => {},
      },
    ]);

    expect(markup).toContain('1 more question from friends');
    expect(markup).not.toContain('1 more questions');
  });
});

describe('bonus-slot opt-out placement', () => {
  const bonusQuestion = (over: Partial<Extract<ChatMessage, { kind: 'question' }>> = {}) =>
    ({
      id: 'q-5',
      kind: 'question',
      assignmentId: '5',
      questionText: 'What is a letter of marque?',
      creatorName: null,
      presenceSourceName: 'Joshua P',
      presenceSourceExtraCount: 0,
      isNew: false,
      ...over,
    }) as ChatMessage;

  it('no longer offers the opt-out as a peer action link', () => {
    const markup = renderToStaticMarkup(
      <GameplayChatThread
        messages={[bonusQuestion()]}
        onGiveUp={() => {}}
        onDismiss={() => {}}
        onMutePresence={() => {}}
      />,
    );

    // The old peer-row label led with the inviting friend's name and buried the
    // negation at the end — that is what read as "continue".
    expect(markup).not.toContain('bag but not mine');
    // The genuine ways forward stay where they were.
    expect(markup).toContain('Show me the answer');
    expect(markup).toContain('Dismiss');
  });

  // The menu renders collapsed in static markup, so the ITEM copy ("Stop showing
  // me this category") isn't assertable here — this repo has no DOM-interaction
  // test setup. What is assertable, and what the regression is actually about, is
  // that a bonus slot now routes the opt-out through a ⋯ trigger instead of a
  // peer link (asserted above).
  it('gives a bonus slot a ⋯ overflow to hold the demoted opt-out', () => {
    const markup = renderToStaticMarkup(
      <GameplayChatThread messages={[bonusQuestion()]} onMutePresence={() => {}} />,
    );

    expect(markup).toContain('More actions');
    expect(markup).toContain('aria-haspopup="menu"');
  });

  it('renders no overflow for a non-bonus slot', () => {
    const markup = renderToStaticMarkup(
      <GameplayChatThread
        messages={[bonusQuestion({ presenceSourceName: null })]}
        onMutePresence={() => {}}
      />,
    );

    expect(markup).not.toContain('Stop showing me this category');
    expect(markup).not.toContain('More actions');
  });
});

describe('rest notice', () => {
  it('offers an undo on a rested category', () => {
    const markup = html([
      {
        id: 's-5',
        kind: 'rest_notice',
        text: "Resting Golden Age of Piracy. You won't see these in your five.",
        onUndo: async () => {},
      },
    ]);

    expect(markup).toContain('Resting Golden Age of Piracy');
    expect(markup).toContain('Undo');
  });

  it('a declined bonus slot is a plain skip with nothing to undo', () => {
    // "No thanks" writes no preference, so the notice must not imply one was made
    // — offering "Undo" there would suggest a rest the player never performed.
    const markup = html([{ id: 's-5', kind: 'system', text: 'Skipped for today.' }]);

    expect(markup).toContain('Skipped for today.');
    expect(markup).not.toContain('Undo');
    expect(markup).not.toContain('Resting');
  });
});
