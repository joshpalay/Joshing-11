import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';

import { DomainCircle } from '@/components/knowledge/DomainCircle';
import { getSession } from '@/server/auth/session';
import { getJoshingGame, type JoshingGameView } from '@/server/db/queries/joshing-game';

type PageProps = {
  params: Promise<{ id: string }>;
};

function domainFor(question: JoshingGameView['questions'][number]['question']) {
  return question.canonicalSubcategory || question.broadCategory || question.category || 'General';
}

function explanationFor(question: JoshingGameView['questions'][number]['question']) {
  return question.explainerFullWrong
    ?? question.explainerFull
    ?? question.explainerBriefWrong
    ?? question.explainerBrief
    ?? question.factualExplanation
    ?? 'No explanation available.';
}

function truncate(value: string, max = 48) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function responseKey(userId: string, questionId: string) {
  return `${userId}:${questionId}`;
}

export default async function JoshingGameSummaryPage({ params }: PageProps) {
  const session = await getSession();
  if (!session) notFound();

  const { id } = await params;
  const view = await getJoshingGame({ gameId: id, requestingUserId: session.userId });
  if (!view) notFound();
  const isCreator = view.game.creatorId === session.userId;
  const isRecipient = view.recipients.some((recipient) => recipient.userId === session.userId);
  if (!isCreator && !isRecipient) notFound();
  if (view.viewerStatus === 'not_started') redirect(`/games/${id}`);

  const questionCount = view.questions.length;
  const responseByUserQuestion = new Map(view.responses.map((response) => [responseKey(response.userId, response.questionId), response]));
  const viewerResponses = view.responses.filter((response) => response.userId === session.userId);
  const viewerHasPlayed = viewerResponses.length >= questionCount;
  const viewerCorrect = viewerResponses.filter((response) => response.isCorrect).length;
  const totalAnswers = view.responses.length;

  const questionStats = view.questions.map((gameQuestion) => {
    const responses = view.responses.filter((response) => response.questionId === gameQuestion.questionId);
    const correct = responses.filter((response) => response.isCorrect).length;
    const rate = responses.length ? Math.round((correct / responses.length) * 100) : 0;
    return { gameQuestion, responses, correct, rate };
  });
  const answeredStats = questionStats.filter((stat) => stat.responses.length > 0);
  const hardest = answeredStats.length ? [...answeredStats].sort((a, b) => a.rate - b.rate)[0] : null;
  const easiest = answeredStats.length > 1 ? [...answeredStats].sort((a, b) => b.rate - a.rate)[0] : null;

  const domains = new Map<string, { correct: number; total: number }>();
  for (const gameQuestion of view.questions) {
    const domain = domainFor(gameQuestion.question);
    const response = responseByUserQuestion.get(responseKey(session.userId, gameQuestion.questionId));
    const current = domains.get(domain) ?? { correct: 0, total: 0 };
    domains.set(domain, {
      correct: current.correct + (response?.isCorrect ? 1 : 0),
      total: current.total + 1,
    });
  }

  const onlyViewerGotThis = view.questions.find((gameQuestion) => {
    const correctResponses = view.responses.filter((response) => response.questionId === gameQuestion.questionId && response.isCorrect);
    return correctResponses.length === 1 && correctResponses[0]?.userId === session.userId;
  });

  const discovered = view.questions.filter((gameQuestion) => {
    const response = responseByUserQuestion.get(responseKey(session.userId, gameQuestion.questionId));
    return !response?.isCorrect;
  });

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      {view.viewerStatus === 'in_progress' ? (
        <div className="mb-4 rounded-md border bg-muted p-3 text-sm">Finish playing to see full results</div>
      ) : null}

      <section className="card p-5">
        <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">The Story</p>
        <h1 className="mt-2 font-serif text-4xl font-semibold">{view.game.title}</h1>
        {!isCreator ? <p className="mt-2 text-muted-foreground">From {view.creator.displayName}</p> : null}
        <p className="mt-4 text-sm text-muted-foreground">
          {view.recipients.length} players · {totalAnswers} total answers submitted
        </p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {hardest ? (
            <article className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Hardest question</p>
              <p className="mt-2 text-sm">{hardest.gameQuestion.question.questionText}</p>
              <p className="mt-2 font-serif text-2xl">{hardest.rate}%</p>
            </article>
          ) : null}
          {easiest ? (
            <article className="rounded-md border p-3">
              <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Everyone knew this</p>
              <p className="mt-2 text-sm">{easiest.gameQuestion.question.questionText}</p>
              <p className="mt-2 font-serif text-2xl">{easiest.rate}%</p>
            </article>
          ) : null}
        </div>
      </section>

      <section className="card mt-4 p-5">
        <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Your Game</p>
        {viewerHasPlayed ? (
          <>
            <p className="mt-3 font-serif text-4xl font-semibold">{viewerCorrect} out of {questionCount}</p>
            <div className="mt-5 flex flex-wrap gap-4">
              {[...domains].map(([domain, stat]) => (
                <div key={domain} className="text-center">
                  <DomainCircle diameter={72} iconKey={domain} canonicalSubcategory={domain} currentTier={null} showTierLabel={false} />
                  <p className="mt-1 text-xs text-muted-foreground">{stat.correct}/{stat.total}</p>
                </div>
              ))}
            </div>
            <article className="mt-5 rounded-md border p-3">
              <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Only you got this</p>
              <p className="mt-2 text-sm">{onlyViewerGotThis ? onlyViewerGotThis.question.questionText : 'No solo pulls this time.'}</p>
            </article>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Play to see your results.</p>
        )}
      </section>

      {viewerHasPlayed ? (
        <section className="card mt-4 p-5">
          <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">What You Discovered</p>
          {discovered.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">You got everything in this game.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {discovered.map((gameQuestion) => (
                <article key={gameQuestion.questionId} className="rounded-md border p-3">
                  <p className="font-medium">{gameQuestion.question.questionText}</p>
                  <p className="mt-2 text-sm">Answer: {gameQuestion.question.answerText}</p>
                  <p className="mt-2 text-sm text-muted-foreground">{explanationFor(gameQuestion.question)}</p>
                </article>
              ))}
            </div>
          )}
          <button className="btn-ghost mt-4" type="button" disabled>Replay coming soon</button>
        </section>
      ) : null}

      <section className="card mt-4 p-5">
        <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">How Everyone Did</p>
        {viewerHasPlayed || isCreator ? (
          <>
            <div className="mt-4 space-y-2">
              {view.recipients.map((recipient) => (
                <div key={recipient.userId} className="flex items-center justify-between rounded-md border p-3 text-sm">
                  <span>{recipient.displayName}</span>
                  <span>{recipient.score ?? view.responses.filter((response) => response.userId === recipient.userId && response.isCorrect).length}/{questionCount} {recipient.completedAt ? '✓' : ''}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 overflow-x-auto">
              <table className="w-full min-w-[560px] border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="border-b p-2 text-left">Question</th>
                    {view.recipients.map((recipient) => <th key={recipient.userId} className="border-b p-2 text-center">{recipient.displayName}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {view.questions.map((gameQuestion) => (
                    <tr key={gameQuestion.questionId}>
                      <td className="border-b p-2">{truncate(gameQuestion.question.questionText)}</td>
                      {view.recipients.map((recipient) => {
                        const response = responseByUserQuestion.get(responseKey(recipient.userId, gameQuestion.questionId));
                        return (
                          <td key={recipient.userId} className="border-b p-2 text-center">
                            {response ? (response.isCorrect ? '✓' : '✗') : '—'}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">Play to unlock results.</p>
        )}
      </section>

      <Link className="btn-ghost mt-4" href="/feed">Back to Feed</Link>
    </main>
  );
}
