import type * as React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { GameplayChatThread, type ChatMessage } from '@/components/play/GameplayChat';
import { HOUSE_AUTHOR } from '@/lib/questions-types';

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

describe('GameplayChat house author labeling (D-3 Stage 2)', () => {
  it('renders the house name with the Editorial badge and no relational copy (Invariant H-2)', () => {
    const rendered = html([
      questionMessage({ creatorName: HOUSE_AUTHOR.displayName, creatorIsHouse: true }),
    ]);
    expect(rendered).toContain('Joshing');
    expect(rendered).toContain('Editorial'); // the persistent badge
    expect(rendered).toContain('editorial-badge');
    // Non-relational: a machine/house question never implies a person.
    expect(rendered).not.toContain('gave you this');
    // Invariant H-1 at the render layer: house never falls back to 'A friend'.
    expect(rendered).not.toContain('A friend');
    // Invariant H-3: the house author's name is never a follow/peer-profile
    // affordance. It renders as plain text — no profile link, no Add-friend CTA.
    expect(rendered).not.toContain('href="/users/');
    expect(rendered).not.toMatch(/<a[^>]*>Joshing<\/a>/);
    expect(rendered).not.toContain('Add friend');
    expect(rendered).not.toContain('Follow');
  });

  it('does NOT badge a human author who merely happens to be named "Joshing" (no string-match false positive)', () => {
    const rendered = html([
      // Same display name, but a real human author (creatorIsHouse is false).
      questionMessage({ creatorName: 'Joshing', creatorIsHouse: false }),
    ]);
    expect(rendered).toContain('Joshing');
    expect(rendered).toContain('gave you this'); // treated as a person
    expect(rendered).not.toContain('editorial-badge');
    expect(rendered).not.toContain('Editorial');
  });

  it('leaves the existing LLM "Generated" treatment unbadged and non-relational', () => {
    const rendered = html([
      questionMessage({ creatorName: 'Generated', creatorIsHouse: false }),
    ]);
    expect(rendered).toContain('Generated');
    expect(rendered).not.toContain('gave you this');
    expect(rendered).not.toContain('editorial-badge');
  });
});

function houseResultWithNote(): ChatMessage {
  return {
    id: 'r1',
    kind: 'result',
    assignmentId: 'a1',
    questionText: 'Who produced Low (1977)?',
    result: 'correct',
    submitted: 'Visconti',
    correctAnswer: null,
    consolation: null,
    breadcrumb: null,
    copyVariant: 0,
    creatorName: HOUSE_AUTHOR.displayName,
    creatorIsHouse: true,
    authorNote: 'A favorite from the archives.',
  };
}

describe('GameplayChat house commentary (D-3 Stage 5)', () => {
  it('renders a house creator-note in editorial voice with the badge, never relational framing', () => {
    const rendered = html([houseResultWithNote()]);
    expect(rendered).toContain('A favorite from the archives.');
    // Editorial treatment, not "Why {name} asked".
    expect(rendered).toContain('Editor');
    expect(rendered).toContain('editorial-badge');
    expect(rendered).not.toContain('Why Joshing asked');
    // No relational copy anywhere on a house result.
    expect(rendered).not.toContain('gave you this');
    expect(rendered).not.toContain('carries this one');
    expect(rendered).not.toContain('From Joshing');
  });
});
