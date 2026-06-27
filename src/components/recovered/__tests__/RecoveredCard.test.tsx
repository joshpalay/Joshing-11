import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecoveredCard } from '../RecoveredCard';
import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

// D-REVIEW-RECOVERED-01 (Decision B) — the review card renders a real answer
// form. Two properties matter on first paint and are DOM-free to assert:
//   - the canonical answer is NOT in the initial markup (it is revealed only
//     through the graded submission, keeping the interaction "recall, then
//     check" — the answer never ships in the page payload);
//   - rendering issues no network call (no grade until the player submits).
// The "unscored is never a miss" guarantee lives at the route boundary
// (route.test.ts): the route returns no `isCorrect` for an unscored grade, so
// the UI can never receive a miss to render.

const QUESTION: RecoveredQuestion = {
  id: 'me-1',
  questionId: 'q-1',
  questionText: 'Who wrote the Storia d’Italia?',
  category: 'history',
  recoveredAt: new Date('2026-06-01T00:00:00Z'),
};

describe('RecoveredCard — graded answer form', () => {
  it('renders an answer form, not a pre-revealed answer, and fetches nothing on render', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const html = renderToStaticMarkup(<RecoveredCard question={QUESTION} />);

    // The question and an input form are present.
    expect(html).toContain(QUESTION.questionText);
    expect(html).toContain('<form');
    expect(html).toContain('<input');
    expect(html).toContain('Check my answer');

    // The answer is NOT pre-loaded — RecoveredQuestion carries no answerText,
    // and nothing leaks an answer into the initial markup.
    expect(html).not.toContain('Guicciardini');
    expect(html).not.toContain('Answer:');

    // No grading happens until the player submits.
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});
