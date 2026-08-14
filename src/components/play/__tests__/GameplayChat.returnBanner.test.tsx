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

// D-MISSED-RETURN-01 R9 — the "SECOND LOOK" banner is the honest mark that keeps
// a returning question from reading as new. It replaced a muted badge chip that
// proved too quiet to notice: measured on a live account, four returns were
// played across five days without the player registering any as returns.
describe('GameplayChat returning-question banner', () => {
  it('marks a wrong-scope return with SECOND LOOK and the date last seen', () => {
    const rendered = html([
      questionMessage({ returnLastSeenAt: '2026-08-03T14:00:00.000Z' }),
    ]);
    expect(rendered).toContain('Second look');
    expect(rendered).toContain('LAST SEEN AUGUST 3');
  });

  it('renders NO banner when returnLastSeenAt is absent', () => {
    // The expired scope routes here: it has never been seen by the player, so it
    // gets no return framing at all and reads as a normal question arriving late
    // (§2). The caller (daily/page.tsx) enforces that by passing null.
    const rendered = html([questionMessage({})]);
    expect(rendered).not.toContain('Second look');
    expect(rendered).not.toContain('LAST SEEN');
  });

  it('degrades to no banner on an unparseable timestamp rather than "INVALID DATE"', () => {
    const rendered = html([questionMessage({ returnLastSeenAt: 'not-a-date' })]);
    expect(rendered).not.toContain('Second look');
    expect(rendered).not.toContain('INVALID');
  });

  it('never stacks two banners — a bonus slot keeps its own attribution', () => {
    // Bonus wins if both are somehow set, so the card can only ever grow one
    // banner. The gold ✦ treatment stays unique to a friend's gift.
    const rendered = html([
      questionMessage({
        presenceSourceName: 'Sarah Kim',
        returnLastSeenAt: '2026-08-03T14:00:00.000Z',
      }),
    ]);
    expect(rendered).toContain('Bonus item');
    expect(rendered).toContain('FROM SARAH’S KNOWLEDGE');
    expect(rendered).not.toContain('Second look');
  });

  it('keeps grading colors out of the mark (§1 — a return is not remediation)', () => {
    // A red/green banner would turn an honest label into "you got this wrong".
    // The banner is built from neutral tokens only.
    const rendered = html([
      questionMessage({ returnLastSeenAt: '2026-08-03T14:00:00.000Z' }),
    ]);
    const banner = rendered.slice(0, rendered.indexOf('Goldberg'));
    // The grading tokens are reserved (globals.css §"Correct/wrong (grading)").
    expect(banner).not.toContain('--game-correct');
    expect(banner).not.toContain('--game-wrong');
    // Gold is the friend's-gift signal and stays unique to the bonus banner.
    expect(banner).not.toContain('--accent-gold');
  });
});
