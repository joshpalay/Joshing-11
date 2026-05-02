import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { and, eq, sql } from 'drizzle-orm';

import { QuestionRatingButtons } from '@/components/games/QuestionRatingButtons';
import { AddToBankAction } from '@/components/AddToBankAction';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { getSession } from '@/server/auth/session';
import { getDeliveredCreatorNotesForQuestions } from '@/server/creator-notes';
import { db, masteryEvents } from '@/server/db';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import { getJoshingGame, type JoshingGameView } from '@/server/db/queries/joshing-game';

type PageProps = {
  params: Promise<{ id: string }>;
};

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

const titleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '1.05rem',
  fontWeight: 600,
  color: '#111111',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const domainPalette = ['#178245', '#b7791f', '#2563eb', '#9f1239', '#6d28d9', '#0f766e'];

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

function resultLabel(isCorrect: boolean | null | undefined) {
  return isCorrect ? 'CORRECT' : 'WRONG';
}

function formatGameDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(value);
}

function domainColor(domain: string) {
  const total = [...domain].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return domainPalette[total % domainPalette.length] ?? domainPalette[0];
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
  const bankedById = await checkBankedQuestions(session.userId, view.questions.map((question) => question.questionId));
  const creatorNotesByQuestionId = await getDeliveredCreatorNotesForQuestions(
    session.userId,
    view.questions.map((question) => question.questionId),
  );
  const responseByUserQuestion = new Map(view.responses.map((response) => [responseKey(response.userId, response.questionId), response]));
  const viewerResponses = view.responses.filter((response) => response.userId === session.userId);
  const viewerHasPlayed = viewerResponses.length >= questionCount;
  const viewerCorrect = viewerResponses.filter((response) => response.isCorrect).length;
  const viewerSkipped = Math.max(0, questionCount - viewerResponses.length);
  const gameAnswerIdPrefix = `joshing_game:${id}:%`;

  const masteryRows = await db
    .select({
      domain: masteryEvents.canonicalSubcategory,
      awardedPoints: masteryEvents.awardedPoints,
    })
    .from(masteryEvents)
    .where(and(
      eq(masteryEvents.userId, session.userId),
      eq(masteryEvents.sessionContext, 'joshing_game'),
      sql`${masteryEvents.answerId} like ${gameAnswerIdPrefix}`,
    ));

  const growthByDomain = new Map<string, number>();
  for (const row of masteryRows) {
    growthByDomain.set(row.domain, (growthByDomain.get(row.domain) ?? 0) + Number(row.awardedPoints ?? 0));
  }

  const fallbackPoints = viewerResponses.reduce((sum, response) => sum + Number(response.pointsAwarded ?? 0), 0);
  const totalPoints = masteryRows.length > 0
    ? masteryRows.reduce((sum, row) => sum + Number(row.awardedPoints ?? 0), 0)
    : fallbackPoints;

  const growthRows = [...growthByDomain]
    .map(([domain, points]) => ({ domain, points }))
    .sort((a, b) => b.points - a.points || a.domain.localeCompare(b.domain));

  const authoredQuestionIds = new Set(
    view.questions
      .filter((gameQuestion) => gameQuestion.question.creatorId === session.userId)
      .map((gameQuestion) => gameQuestion.questionId),
  );
  const authoredQuestionsAnsweredCorrectly = new Set(
    view.responses
      .filter((response) => (
        response.userId !== session.userId
        && response.isCorrect
        && authoredQuestionIds.has(response.questionId)
      ))
      .map((response) => response.questionId),
  );
  const impactCount = authoredQuestionsAnsweredCorrectly.size;
  const showGroupProgress = view.recipients.length > 1;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      {view.viewerStatus === 'in_progress' ? (
        <div className="mb-4 rounded-md border bg-muted p-3 text-sm">Finish playing to see full results</div>
      ) : null}

      <header>
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
          <Link href="/feed" className="underline underline-offset-2">HOME</Link>
          {' / '}
          {view.game.title}
          {' / SUMMARY'}
        </p>
        <h1
          style={{
            marginTop: '10px',
            fontFamily: 'var(--font-neutral), system-ui, sans-serif',
            fontSize: '1.45rem',
            fontWeight: 700,
            color: '#111111',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          How You Did
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatGameDate(view.game.createdAt)}</p>
      </header>

      <section
        className="mt-5 rounded-md border px-5 py-5"
        style={{
          background: 'color-mix(in srgb, var(--success) 10%, var(--surface))',
          borderColor: 'color-mix(in srgb, var(--success) 22%, var(--border))',
        }}
      >
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>Total</p>
        <p className="mt-2 font-mono text-5xl font-bold leading-none text-[#111111]">+{Math.round(totalPoints)}</p>
        <p style={{ ...monoStyle, marginTop: '12px', color: 'var(--text-muted)' }}>
          {viewerCorrect}/{questionCount} correct{viewerSkipped > 0 ? ` · ${viewerSkipped} skipped` : ''}
        </p>
      </section>

      {viewerHasPlayed ? (
        <section className="mt-6">
          <h2 style={titleStyle}>Round Recap</h2>
          <div className="mt-3 space-y-3">
            {view.questions.map((gameQuestion) => {
              const response = responseByUserQuestion.get(responseKey(session.userId, gameQuestion.questionId));
              const correct = Boolean(response?.isCorrect);
              const creatorNote = creatorNotesByQuestionId.get(gameQuestion.questionId);

              return (
                <article key={gameQuestion.questionId} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
                      {gameQuestion.question.creatorId === view.game.creatorId
                        ? `From ${view.creator.displayName}`
                        : 'From the question bank'}
                    </p>
                    <span
                      className={`rounded-sm border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em] ${
                        correct
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-rose-200 bg-rose-50 text-rose-700'
                      }`}
                    >
                      {resultLabel(response?.isCorrect)}
                    </span>
                  </div>
                  <p className="mt-3 font-medium leading-snug text-foreground">{gameQuestion.question.questionText}</p>
                  <div className="mt-3 space-y-1 text-sm">
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">You:</span>{' '}
                      {response?.submittedAnswer?.trim() || 'No answer submitted'}
                    </p>
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">Answer:</span> {gameQuestion.question.answerText}
                    </p>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-muted-foreground">{explanationFor(gameQuestion.question)}</p>
                  {creatorNote ? (
                    <p className="mt-3 rounded-md border bg-muted/50 p-3 text-sm leading-6 text-foreground">
                      <span className="font-medium">A note from {creatorNote.authorName}:</span>{' '}
                      {creatorNote.noteText}
                    </p>
                  ) : null}
                  <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                    <QuestionRatingButtons questionId={gameQuestion.questionId} />
                    <SendQuestionAction
                      question={{
                        id: gameQuestion.questionId,
                        text: gameQuestion.question.questionText,
                        domain: domainFor(gameQuestion.question),
                      }}
                      label=""
                      className="inline-flex size-9 items-center justify-center rounded-md border text-muted-foreground transition hover:bg-muted hover:text-foreground"
                    />
                    <AddToBankAction
                      questionId={gameQuestion.questionId}
                      initialInBank={Boolean(bankedById[gameQuestion.questionId])}
                      contextType="joshing_game"
                      contextId={id}
                      label=""
                      className="inline-flex size-9 items-center justify-center rounded-md border px-0"
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="card mt-4 px-5 py-4">
        <h2 style={titleStyle}>Your Growth Recap</h2>
        {growthRows.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No mastery movement was recorded for this game.</p>
        ) : (
          <div className="mt-3 divide-y">
            {growthRows.map((row) => {
              const gainedPoints = Math.round(row.points);
              const isNewTerritory = gainedPoints === 0;

              return (
                <div key={row.domain} className="flex items-center gap-3 py-3">
                  <span
                    className="h-4 w-4 shrink-0 rounded-full border"
                    style={{
                      background: isNewTerritory ? 'var(--muted)' : domainColor(row.domain),
                      borderColor: isNewTerritory ? 'var(--border)' : 'transparent',
                    }}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    {isNewTerritory ? (
                      <p style={{ ...monoStyle, fontSize: '0.52rem', color: 'var(--text-muted)' }}>New territory</p>
                    ) : null}
                    <p className="truncate font-serif text-sm font-bold text-[#111111]">{row.domain}</p>
                  </div>
                  <p className="shrink-0 font-mono text-sm font-bold uppercase text-[#111111]">+{gainedPoints} PTS</p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card mt-4 px-5 py-4">
        <h2 style={titleStyle}>Your Impact Recap</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--text)]">
          {impactCount > 0
            ? `${impactCount} of your questions were answered correctly this round.`
            : 'None of your questions were answered correctly this season.'}
        </p>
      </section>

      {showGroupProgress ? (
        <section className="card mt-4 p-5">
          <h2 style={titleStyle}>Group Progress Recap</h2>
          {viewerHasPlayed || isCreator ? (
            <>
              <p style={{ ...monoStyle, marginTop: '14px', color: 'var(--text-muted)' }}>How Everyone Did</p>
              <div className="mt-3 space-y-2">
                {view.recipients.map((recipient) => (
                  <div key={recipient.userId} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <span>{recipient.displayName}</span>
                    <span>
                      {recipient.score ?? view.responses.filter((response) => response.userId === recipient.userId && response.isCorrect).length}/{questionCount}
                      {recipient.completedAt ? ' done' : ''}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-5 overflow-x-auto">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="border-b p-2 text-left">Question</th>
                      {view.recipients.map((recipient) => (
                        <th key={recipient.userId} className="border-b p-2 text-center">{recipient.displayName}</th>
                      ))}
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
                              {response ? (response.isCorrect ? 'Y' : 'N') : '-'}
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
      ) : null}

      <Link className="btn-ghost mt-4" href="/feed">Back to Feed</Link>
    </main>
  );
}
