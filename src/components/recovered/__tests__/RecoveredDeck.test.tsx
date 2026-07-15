import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecoveredDeck } from '../RecoveredDeck';
import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

// D-REVIEW-RECOVERED-01 (Decision B + revised C) — landing + full-screen mode.
// SSR-renderable assertions (initial state only; the takeover itself is
// client-side interaction):
//   - the page lands on a count + Start CTA, with NO question text and no
//     answers in the initial markup (questions are dealt inside the mode);
//   - dismissed questions live on a collapsed shelf with a Restore action;
//   - the three empty registers (cold start / bounded range / all dismissed)
//     each render their own copy, and Start disappears with an empty deck.

function question(over: Partial<RecoveredQuestion> = {}): RecoveredQuestion {
  return {
    id: 'me-1',
    questionId: 'q-1',
    questionText: 'Who wrote the Storia d’Italia?',
    category: 'history',
    recoveredAt: new Date('2026-06-01T00:00:00Z'),
    answer: 'Francesco Guicciardini',
    explanation: 'A Florentine historian and statesman.',
    creatorNote: null,
    setAside: false,
    ...over,
  };
}

const DECK = [
  question(),
  question({ id: 'me-2', questionId: 'q-2', questionText: 'Largest planet?', answer: 'Jupiter' }),
];

describe('RecoveredDeck — landing', () => {
  it('shows the circulation count and Start, with no question or answer up front', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const html = renderToStaticMarkup(
      <RecoveredDeck deck={DECK} dismissed={[]} rangeLabel={null} />,
    );

    expect(html).toContain('questions in circulation');
    expect(html).toContain('Start revisiting');

    // Questions are dealt inside the full-screen mode, not on the landing.
    expect(html).not.toContain('Who wrote the Storia d’Italia?');
    expect(html).not.toContain('Largest planet?');
    expect(html).not.toContain('Francesco Guicciardini');
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('names the active range in the count line', () => {
    const html = renderToStaticMarkup(
      <RecoveredDeck deck={DECK} dismissed={[]} rangeLabel="past week" />,
    );
    expect(html).toContain('from the past week');
  });

  it('lists dismissed questions on a collapsed shelf with a Restore action', () => {
    const html = renderToStaticMarkup(
      <RecoveredDeck
        deck={DECK}
        dismissed={[
          question({
            id: 'me-3',
            questionId: 'q-3',
            questionText: 'Smallest prime?',
            setAside: true,
          }),
        ]}
        rangeLabel={null}
      />,
    );

    expect(html).toContain('Dismissed (1)');
    expect(html).toContain('Smallest prime?');
    expect(html).toContain('Restore');
  });

  it('hides the dismissed shelf when nothing is dismissed', () => {
    const html = renderToStaticMarkup(
      <RecoveredDeck deck={DECK} dismissed={[]} rangeLabel={null} />,
    );
    expect(html).not.toContain('Dismissed (');
  });
});

describe('RecoveredDeck — empty registers', () => {
  it('renders the cold-start register when there is nothing at all', () => {
    const html = renderToStaticMarkup(<RecoveredDeck deck={[]} dismissed={[]} rangeLabel={null} />);
    expect(html).toContain('will gather here as you play');
    expect(html).not.toContain('Start revisiting');
  });

  it('renders the bounded-empty register when a range window comes up empty', () => {
    const html = renderToStaticMarkup(
      <RecoveredDeck deck={[]} dismissed={[]} rangeLabel="past week" />,
    );
    expect(html).toContain('Nothing turned around in the past week');
  });

  it('renders the all-dismissed register when every question is out of circulation', () => {
    const html = renderToStaticMarkup(
      <RecoveredDeck
        deck={[]}
        dismissed={[question({ setAside: true })]}
        rangeLabel={null}
      />,
    );
    expect(html).toContain('Everything here is dismissed');
  });
});
