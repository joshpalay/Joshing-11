import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import type { StreamItem, StreamQuestion } from '@/lib/activity-stream';

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

// The answer/grade flow is exercised by its own surfaces; stub it so this test
// stays on FromFriendsStreak's own rendering (header fork, card frame, spent
// state, provenance) and doesn't pull in the answer sheets.
vi.mock('@/components/activity/use-milestone-answer', () => ({
  useMilestoneAnswer: () => ({ open: () => {}, isOpen: false, sheets: null }),
}));

import { FromFriendsStreak } from '@/components/feed/FromFriendsStreak';

const q = (questionId: string, overrides: Partial<StreamQuestion> = {}): StreamQuestion => ({
  questionId,
  text: `Question ${questionId}`,
  domain: 'Tennis Fundamentals',
  priorResult: null,
  ...overrides,
});

function streakItem(
  questions: StreamQuestion[],
  friendName = 'Joshua P',
  friendId = 'friend-1',
): StreamItem {
  return {
    id: 'm-1',
    sortAt: new Date('2026-06-20T12:00:00Z'),
    tier: 0,
    friendId,
    homeEligible: true,
    line: [
      { t: 'actor', name: friendName, userId: friendId },
      { t: 'text', v: ' has been on a tear through ' },
      { t: 'category', v: 'Tennis Fundamentals' },
    ],
    secondLine: null,
    anchorId: null,
    action: null,
    icon: 'bundle',
    expand: { kind: 'milestone', friendId, friendName, questions },
  };
}

// Count the active answer cards: SparkleEnvelope renders Answer as a btn-primary
// button, present only on still-answerable cards (spent cards drop the actions).
function answerCardCount(html: string): number {
  return (html.match(/btn-primary/g) ?? []).length;
}

describe('FromFriendsStreak — header-presence fork (D-C)', () => {
  it('renders a header + one card per question for a ≥2 bundle', () => {
    const html = renderToStaticMarkup(<FromFriendsStreak item={streakItem([q('a'), q('b')])} />);
    // The streak line renders as a header (the friend + the rolled-up domains).
    expect(html).toContain('has been on a tear through');
    expect(html).toContain('Tennis Fundamentals');
    // One answerable card per question.
    expect(answerCardCount(html)).toBe(2);
    expect(html).toContain('Question a');
    expect(html).toContain('Question b');
    // No per-card "via" line when the header carries the attribution.
    expect(html).not.toContain('via ');
  });

  it('renders a single card with NO header and a "via {friend}’s streak" line for a 1-question bundle', () => {
    const html = renderToStaticMarkup(<FromFriendsStreak item={streakItem([q('solo')])} />);
    // No header: the streak predicate / domain roll-up sentence is absent.
    expect(html).not.toContain('has been on a tear through');
    // The lone card carries the compact answerer-streak attribution instead.
    expect(html).toContain('via ');
    expect(html).toContain('Joshua P');
    expect(html).toContain('streak');
    // The card still leads with its category eyebrow.
    expect(html).toContain('Tennis Fundamentals');
    expect(answerCardCount(html)).toBe(1);
  });
});

describe('FromFriendsStreak — headerless (streak page) mode', () => {
  it('drops the streak header AND the per-card via line, rendering bare cards', () => {
    const html = renderToStaticMarkup(
      <FromFriendsStreak item={streakItem([q('a'), q('b')])} headerless />,
    );
    // The page header carries attribution, so the component renders neither the
    // internal streak header nor a per-card "via {friend}'s streak" line.
    expect(html).not.toContain('has been on a tear through');
    expect(html).not.toContain('via ');
    // The answerable cards (and their category eyebrows) still render.
    expect(answerCardCount(html)).toBe(2);
    expect(html).toContain('Question a');
    expect(html).toContain('Tennis Fundamentals');
  });

  it('drops the via line for a lone-question bundle too', () => {
    const html = renderToStaticMarkup(
      <FromFriendsStreak item={streakItem([q('solo')])} headerless />,
    );
    expect(html).not.toContain('via ');
    expect(answerCardCount(html)).toBe(1);
  });
});

describe('FromFriendsStreak — answered questions resolve in place (Phase 2)', () => {
  it('keeps a correctly-answered question as a spent "✓ Correct" card with a Send-onward affordance', () => {
    const html = renderToStaticMarkup(
      <FromFriendsStreak item={streakItem([q('done', { priorResult: 'correct' }), q('fresh')])} />,
    );
    // The answered-correct question stays visible as a settled card (it is no
    // longer answerable but it IS forwardable), only the fresh one is playable.
    expect(html).toContain('Question done');
    expect(html).toContain('✓ Correct');
    expect(html).toContain('Send onward');
    expect(html).toContain('Question fresh');
    expect(answerCardCount(html)).toBe(1);
  });

  it('keeps an incorrectly-answered question as a spent "Not this time" card with a Send-onward affordance', () => {
    const html = renderToStaticMarkup(
      <FromFriendsStreak
        item={streakItem([q('missed', { priorResult: 'incorrect' }), q('fresh')])}
      />,
    );
    // A miss stays visible (spent) and forwardable, only the fresh one is still answerable.
    expect(html).toContain('Not this time');
    expect(html).toContain('Question missed');
    expect(html).toContain('Send onward');
    expect(answerCardCount(html)).toBe(1);
  });

  it('keeps every already-answered question visible as a forwardable spent card', () => {
    const html = renderToStaticMarkup(
      <FromFriendsStreak
        item={streakItem([q('a', { priorResult: 'correct' }), q('b', { priorResult: 'correct' })])}
      />,
    );
    // The streak no longer collapses to nothing when all its questions are
    // answered — each settled question reads as correct and can be sent onward.
    expect(html).not.toBe('');
    expect(html).toContain('Question a');
    expect(html).toContain('Question b');
    expect(html).toContain('✓ Correct');
    expect(html).toContain('Send onward');
    // None are answerable any more.
    expect(answerCardCount(html)).toBe(0);
  });
});

describe('FromFriendsStreak — report affordance + author placement', () => {
  it('renders a report (⋯) control in the upper-right corner of every card', () => {
    const html = renderToStaticMarkup(<FromFriendsStreak item={streakItem([q('a'), q('b')])} />);
    // The ⋯ menu (AnsweredRowActions) is the entry point to flag a question as
    // incorrect or inappropriate — one per card.
    expect((html.match(/aria-label="More actions"/g) ?? []).length).toBe(2);
  });

  it('keeps the report control even on a settled (spent) card', () => {
    const html = renderToStaticMarkup(
      <FromFriendsStreak item={streakItem([q('done', { priorResult: 'correct' })])} />,
    );
    expect(html).toContain('aria-label="More actions"');
  });
});

describe('FromFriendsStreak — honest provenance pre-answer (D-D canon)', () => {
  it('marks house/LLM authorship and never falls back to "A friend"', () => {
    const html = renderToStaticMarkup(
      <FromFriendsStreak
        item={streakItem([
          q('house', { authorIsHouse: true, authorName: 'Joshing' }),
          q('llm', { authorName: null }),
          q('human', { authorName: 'Sam Rivera', authorIsHouse: false }),
        ])}
      />,
    );
    // House content shows the house marker; LLM content shows the machine label.
    expect(html).toContain('JOSHING · EDITORIAL');
    expect(html).toContain('MAID ACASA');
    // Canon gate: machine content NEVER renders as if a person wrote it.
    expect(html).not.toContain('A friend');
    // All three cards are answerable (provenance renders pre-answer).
    expect(answerCardCount(html)).toBe(3);
  });
});
