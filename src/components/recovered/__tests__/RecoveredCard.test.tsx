import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecoveredCard } from '../RecoveredCard';
import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

// D-REVIEW-RECOVERED-01 (Decision B) — the review card is a no-check reveal.
// The system never grades a typed answer; it just shows the canonical answer on
// demand. Two properties matter and are DOM-free to assert:
//   - the answer is present in the markup (it ships collapsed inside a native
//     <details>, revealed when the player chooses to check themselves);
//   - there is no answer form and no network call — nothing is scored.

const QUESTION: RecoveredQuestion = {
  id: 'me-1',
  questionId: 'q-1',
  questionText: 'Who wrote the Storia d’Italia?',
  category: 'history',
  recoveredAt: new Date('2026-06-01T00:00:00Z'),
  answer: 'Francesco Guicciardini',
  explanation: 'A Florentine historian and statesman.',
  creatorNote: null,
};

describe('RecoveredCard — no-check reveal', () => {
  it('renders the question and the answer behind a reveal, with no form and no fetch', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const html = renderToStaticMarkup(<RecoveredCard question={QUESTION} />);

    // The question and a reveal trigger are present.
    expect(html).toContain(QUESTION.questionText);
    expect(html).toContain('<details');
    expect(html).toContain('Show answer');

    // The answer ships with the card (collapsed inside <details>).
    expect(html).toContain('Answer:');
    expect(html).toContain('Francesco Guicciardini');
    expect(html).toContain('A Florentine historian and statesman.');

    // The system never checks: no answer form and no grading button.
    expect(html).not.toContain('<form');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('Check my answer');

    // Pure render — no network round-trip.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
