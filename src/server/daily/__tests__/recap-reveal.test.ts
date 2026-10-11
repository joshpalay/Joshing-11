import { describe, expect, it } from 'vitest';

import { recapReveal } from '@/server/daily/recap-reveal';

// QA 2026-10-11, C1: opening /daily/summary mid-round printed the answers to
// the questions still waiting. The answer leaves the server only once played.
describe('recapReveal', () => {
  it('hides the answer and explainer for a question still to play', () => {
    expect(recapReveal({ answered: false, skipped: false }, 'Rosa', 'Roses are Rosa.')).toEqual({
      isPending: true,
      correctAnswer: '',
      explanation: '',
    });
  });

  it('hides them for a skipped question, which comes back in catch-up', () => {
    expect(recapReveal({ answered: false, skipped: true }, 'Rosa', 'Roses are Rosa.')).toEqual({
      isPending: false,
      correctAnswer: '',
      explanation: '',
    });
  });

  it('shows them once the question is answered (right, wrong or "Show me the answer")', () => {
    expect(recapReveal({ answered: true }, 'Rosa', 'Roses are Rosa.')).toEqual({
      isPending: false,
      correctAnswer: 'Rosa',
      explanation: 'Roses are Rosa.',
    });
  });
});
