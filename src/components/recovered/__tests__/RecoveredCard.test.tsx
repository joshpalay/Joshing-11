import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { RecoveredCard } from '../RecoveredCard';
import type { RecoveredQuestion } from '@/server/db/queries/recovered-questions';

// D-REVIEW-RECOVERED-01 (Decision B / Done-When #3) — the reveal performs zero
// writes. The card is a server component whose reveal is a native <details>
// disclosure: there is no answer-submission path, no <form>, and no network on
// reveal, so no `mastery_events` row (or any write) can be minted here.

const QUESTION: RecoveredQuestion = {
  id: 'me-1',
  questionId: 'q-1',
  questionText: 'Who wrote the Storia d’Italia?',
  answerText: 'Francesco Guicciardini',
  factualExplanation: 'A Florentine historian and statesman.',
  category: 'history',
  recoveredAt: new Date('2026-06-01T00:00:00Z'),
};

describe('RecoveredCard — silent self-reveal, no writes', () => {
  it('reveals the answer through a native <details>, not a submittable control', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const html = renderToStaticMarkup(<RecoveredCard question={QUESTION} />);

    // Question and answer both render; the answer sits inside the disclosure.
    expect(html).toContain(QUESTION.questionText);
    expect(html).toContain(QUESTION.answerText);
    expect(html).toContain('<details');
    expect(html).toContain('<summary');
    expect(html).toContain('Reveal the answer');

    // No write path: no form, no submit button, and rendering issues no fetch.
    expect(html).not.toContain('<form');
    expect(html).not.toContain('type="submit"');
    expect(fetchSpy).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  it('omits the explanation paragraph when there is none', () => {
    const html = renderToStaticMarkup(
      <RecoveredCard question={{ ...QUESTION, factualExplanation: null }} />,
    );
    expect(html).toContain(QUESTION.answerText);
    expect(html).not.toContain('A Florentine historian');
  });
});
