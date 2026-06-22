import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { useStreakResolutions } from '@/components/feed/use-streak-resolutions';
import type { StreamQuestion } from '@/lib/activity-stream';

// The per-card resolution state for a From Friends streak
// (B-FROMFRIENDS-STREAK-HEADER-01, Phase 2). The load-bearing behavior is the
// SEED/lock: a question carrying ANY prior result (right OR wrong) mounts as
// resolved, so it persists as spent across a re-render rather than re-offering
// a second swing; a fresh question mounts open. We drive the hook through a
// static-render harness (the suite runs in a node env with no DOM), which
// exercises exactly that seed.

const q = (questionId: string, priorResult: StreamQuestion['priorResult']): StreamQuestion => ({
  questionId,
  text: questionId,
  domain: null,
  priorResult,
});

function Harness({ questions }: { questions: StreamQuestion[] }) {
  const { isResolved, answeredCount } = useStreakResolutions(questions);
  return (
    <div>
      <span>count:{answeredCount}</span>
      {questions.map((question) => (
        <span key={question.questionId}>
          {question.questionId}:{isResolved(question.questionId) ? 'spent' : 'open'}
        </span>
      ))}
    </div>
  );
}

describe('useStreakResolutions', () => {
  it('seeds any prior result (correct OR incorrect) as resolved, fresh as open', () => {
    const html = renderToStaticMarkup(
      <Harness questions={[q('a', 'correct'), q('b', 'incorrect'), q('c', null)]} />,
    );
    expect(html).toContain('a:spent');
    // A prior WRONG attempt locks the card the same way a correct one does — a
    // single attempt is the viewer's only swing in the feed.
    expect(html).toContain('b:spent');
    expect(html).toContain('c:open');
    // answeredCount counts every settled question (server-prior + in-session).
    expect(html).toContain('count:2');
  });

  it('starts an all-fresh streak fully open with a zero count', () => {
    const html = renderToStaticMarkup(<Harness questions={[q('a', null), q('b', null)]} />);
    expect(html).toContain('a:open');
    expect(html).toContain('b:open');
    expect(html).toContain('count:0');
  });
});
