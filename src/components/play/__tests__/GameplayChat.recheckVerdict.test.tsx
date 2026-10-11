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

function wrongCard(over: Partial<Extract<ChatMessage, { kind: 'result' }>>): string {
  return renderToStaticMarkup(
    <GameplayChatThread
      messages={[
        {
          id: 'r1',
          kind: 'result',
          assignmentId: 'a1',
          questionText: 'What makes hydrangeas pink or blue?',
          result: 'wrong',
          submitted: 'the soil',
          correctAnswer: 'Soil pH',
          consolation: null,
          breadcrumb: null,
          copyVariant: 0,
          creatorName: null,
          ...over,
        },
      ]}
    />,
  );
}

// QA 2026-10-11, S1: once an appeal was answered "no", the slot carried a
// recheck_status, the appeal action went null, and the card lost both the
// button and the verdict, so the player never learned why.
describe('GameplayChat rejected-appeal verdict', () => {
  it('keeps the stored verdict on the card after the appeal button is gone', () => {
    const rendered = wrongCard({
      recheckAction: null,
      recheckVerdict: 'Right category, but it is the soil pH that decides the colour.',
    });
    expect(rendered).toContain('it is the soil pH that decides the colour.');
    expect(rendered).not.toContain('Argue your point');
  });

  it('shows the appeal button and no verdict before any appeal', () => {
    const rendered = wrongCard({
      recheckAction: {
        onSubmit: async () => ({ accepted: false, status: 'rejected', message: '' }),
      },
      recheckVerdict: null,
    });
    expect(rendered).toContain('Argue your point');
    expect(rendered).not.toContain('role="status"');
  });
});
