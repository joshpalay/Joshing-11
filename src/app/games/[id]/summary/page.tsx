import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { and, eq, inArray, sql } from 'drizzle-orm';

import { answerHeadingStyle } from '@/components/answer-heading';
import { CreatorNote, pickCreatorNote } from '@/components/CreatorNote';
import { FirstGameRecapGate } from '@/components/games/FirstGameRecapGate';
import { QuestionRatingButtons } from '@/components/games/QuestionRatingButtons';
import { AnsweredRowActions } from '@/components/questions/AnsweredRowActions';
import { AddToBankAction } from '@/components/AddToBankAction';
import { SendQuestionAction } from '@/components/SendQuestionAction';
import { OverlapMap } from '@/components/OverlapMap';
import { CategoryGainsDisplay } from '@/components/review/CategoryGainsDisplay';
import { difficultyCopyFromEstimate } from '@/lib/questions/difficulty-copy';
import MasteryMoment from '@/components/review/MasteryMoment';
import { getSession } from '@/server/auth/session';
import { db, masteryEvents, playerMastery } from '@/server/db';
import { checkBankedQuestions } from '@/server/db/queries/bank';
import { computeOverlapCells, getJoshingGame, type JoshingGameView } from '@/server/db/queries/joshing-game';
import { resolveTier } from '@/server/mastery/tiers';

const CREATOR_COLOR = 'var(--brand-navy)';
const RECIPIENT_COLOR = 'var(--brand-orange)';

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
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--brand-ink)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

function domainFor(question: JoshingGameView['questions'][number]['question']) {
  return question.canonicalSubcategory || question.broadCategory || question.category || 'General';
}

function resolvedDifficulty(question: JoshingGameView['questions'][number]['question']): string | null {
  return question.calibratedDifficulty ?? question.llmDifficulty ?? question.difficultyEstimate ?? null;
}

// Difficulty pills use the triangle palette (amber/dark-yellow/dark-teal) so the
// 3-level metadata scale reads as distinct from the result pill beside it.
// Text is mixed toward --brand-ink so the lighter tones clear AA.
function difficultyPillStyle(level: string): CSSProperties {
  const tone =
    level === 'specialist'
      ? 'var(--tri-amber)'
      : level === 'moderate'
        ? 'var(--tri-darkyellow)'
        : 'var(--tri-darkteal)';
  return {
    borderColor: `color-mix(in srgb, ${tone} 35%, var(--border))`,
    backgroundColor: `color-mix(in srgb, ${tone} 12%, var(--surface))`,
    color: `color-mix(in srgb, ${tone} 55%, var(--brand-ink))`,
  };
}

type ExplainerOutcome = 'correct' | 'wrong' | 'expired';

function explainerVariantsFor(
  question: JoshingGameView['questions'][number]['question'],
  outcome: ExplainerOutcome,
): { brief: string | null; full: string | null } {
  const fallbackBrief = question.explainerBrief ?? null;
  const fallbackFull = question.explainerFull ?? question.factualExplanation ?? null;

  if (outcome === 'correct') {
    return {
      brief: question.explainerBriefCorrect ?? fallbackBrief,
      full: question.explainerFullCorrect ?? fallbackFull,
    };
  }
  if (outcome === 'expired') {
    return {
      brief: question.explainerBriefExpired ?? fallbackBrief,
      full: question.explainerFullExpired ?? fallbackFull,
    };
  }
  return {
    brief: question.explainerBriefWrong ?? fallbackBrief,
    full: question.explainerFullWrong ?? fallbackFull,
  };
}

const kickerStyle: CSSProperties = {
  fontFamily: 'var(--font-display, "Playfair Display"), Georgia, serif',
  fontStyle: 'italic',
  fontSize: '0.78rem',
  letterSpacing: '0.01em',
  color: 'var(--text-muted)',
};

function responseKey(userId: string, questionId: string) {
  return `${userId}:${questionId}`;
}

function resultLabel(isCorrect: boolean | null | undefined) {
  return isCorrect ? 'CORRECT' : 'Not this time';
}

function formatGameDate(value: Date) {
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(value);
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

  const touchedDomains = [...growthByDomain.keys()];
  const masteryAfterRows = touchedDomains.length > 0
    ? await db
        .select({
          domain: playerMastery.canonicalSubcategory,
          broadCategory: playerMastery.broadCategory,
          totalPoints: playerMastery.totalPoints,
          tier: playerMastery.tier,
        })
        .from(playerMastery)
        .where(and(
          eq(playerMastery.userId, session.userId),
          inArray(playerMastery.canonicalSubcategory, touchedDomains),
        ))
    : [];
  const masteryAfterByDomain = new Map(masteryAfterRows.map((row) => [row.domain, row]));
  const broadCategoryByDomain = new Map<string, string>();
  for (const gameQuestion of view.questions) {
    const question = gameQuestion.question;
    const domain = domainFor(question);
    broadCategoryByDomain.set(domain, question.broadCategory || question.category || domain);
  }

  const fallbackPoints = viewerResponses.reduce((sum, response) => sum + Number(response.pointsAwarded ?? 0), 0);
  const totalPoints = masteryRows.length > 0
    ? masteryRows.reduce((sum, row) => sum + Number(row.awardedPoints ?? 0), 0)
    : fallbackPoints;

  const growthRows = [...growthByDomain]
    .map(([domain, points]) => ({ domain, points }))
    .sort((a, b) => b.points - a.points || a.domain.localeCompare(b.domain));
  const growthCircleItems = growthRows.map((row) => {
    const masteryAfter = masteryAfterByDomain.get(row.domain);
    const pointsAfter = Number(masteryAfter?.totalPoints ?? row.points);
    const pointsBefore = Math.max(0, pointsAfter - row.points);
    return {
      canonical_subcategory: row.domain,
      broad_category: masteryAfter?.broadCategory || broadCategoryByDomain.get(row.domain) || row.domain,
      points_before: pointsBefore,
      points_after: pointsAfter,
      tier_before: resolveTier(pointsBefore),
      tier_after: masteryAfter?.tier ?? resolveTier(pointsAfter),
      new_territory: pointsBefore <= 0,
    };
  });
  const firstTierCrossing = growthCircleItems.find((item) => item.tier_before !== item.tier_after);

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

  // TODO: multi-recipient overlap visualization is a separate decision
  // (force-directed web vs. per-recipient strip) — out of scope here.
  const singleRecipient = view.recipients.length === 1 ? view.recipients[0] : null;
  const overlapCells = singleRecipient
    ? computeOverlapCells(view, view.game.creatorId, singleRecipient.userId)
    : [];
  const overlapPlayers = singleRecipient
    ? ([
        { id: view.creator.id, name: view.creator.displayName, color: CREATOR_COLOR },
        { id: singleRecipient.userId, name: singleRecipient.displayName, color: RECIPIENT_COLOR },
      ] as const)
    : null;

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      {view.viewerStatus === 'in_progress' ? (
        <div className="mb-4 rounded-md border bg-muted p-3 text-sm">Finish playing to see full results</div>
      ) : null}

      <header>
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
          <Link href="/" className="underline underline-offset-2">HOME</Link>
          {' / '}
          {view.game.title}
          {' / SUMMARY'}
        </p>
        <h1 className="mt-2 font-serif text-[2rem] leading-tight text-[var(--brand-ink)]">
          How you did
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">{formatGameDate(view.game.createdAt)}</p>
      </header>

      <section
        className="mt-5 rounded-md border px-5 py-5"
        style={{
          background: 'color-mix(in srgb, var(--game-correct) 10%, var(--surface))',
          borderColor: 'color-mix(in srgb, var(--game-correct) 22%, var(--border))',
        }}
      >
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>Total</p>
        <p className="mt-2 font-mono text-5xl font-bold leading-none text-[var(--brand-ink)]">+{Math.round(totalPoints)}</p>
        <p style={{ ...monoStyle, marginTop: '12px', color: 'var(--text-muted)' }}>
          {viewerCorrect}/{questionCount} correct{viewerSkipped > 0 ? ` · ${viewerSkipped} skipped` : ''}
        </p>
      </section>

      <section className="card mt-4 px-5 py-4">
        <h2 style={titleStyle}>Your Growth Recap</h2>
        <CategoryGainsDisplay
          gameItems={growthCircleItems}
          emptyMessage="No mastery movement was recorded for this game."
        />
      </section>

      {firstTierCrossing ? (
        <MasteryMoment
          subcategory={firstTierCrossing.canonical_subcategory}
          newTier={firstTierCrossing.tier_after}
        />
      ) : null}

      {viewerHasPlayed ? (
        <section className="mt-6">
          <h2 style={titleStyle}>Round Recap</h2>
          <div className="mt-3 space-y-3">
            {view.questions.map((gameQuestion) => {
              const response = responseByUserQuestion.get(responseKey(session.userId, gameQuestion.questionId));
              const correct = Boolean(response?.isCorrect);
              const outcome: ExplainerOutcome = !response ? 'expired' : correct ? 'correct' : 'wrong';
              const { brief, full } = explainerVariantsFor(gameQuestion.question, outcome);
              const hasDistinctFull = Boolean(full && full !== brief);
              const briefForDisplay = brief ?? full ?? null;
              const authorNote = gameQuestion.question.creatorNote ?? null;
              const authorName = gameQuestion.question.creatorId === view.game.creatorId
                ? view.creator.displayName
                : null;

              return (
                <article key={gameQuestion.questionId} className="card p-4">
                  <div className="flex items-start justify-between gap-3">
                    <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
                      {gameQuestion.question.creatorId === view.game.creatorId
                        ? `From ${view.creator.displayName}`
                        : 'From the question bank'}
                    </p>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const level = resolvedDifficulty(gameQuestion.question);
                        return level ? (
                          <span
                            className="rounded-sm border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em]"
                            style={difficultyPillStyle(level)}
                          >
                            {difficultyCopyFromEstimate(level) ?? 'Unrated'}
                          </span>
                        ) : null;
                      })()}
                      <span
                        className="rounded-sm border px-2 py-1 text-[0.65rem] font-semibold tracking-[0.08em]"
                        style={
                          correct
                            ? {
                                borderColor: 'color-mix(in srgb, var(--game-correct) 30%, var(--border))',
                                backgroundColor: 'color-mix(in srgb, var(--game-correct) 10%, var(--surface))',
                                color: 'var(--game-correct)',
                              }
                            : {
                                borderColor: 'var(--border)',
                                backgroundColor: 'color-mix(in srgb, var(--muted) 45%, var(--surface))',
                                color: 'var(--text-muted)',
                              }
                        }
                      >
                        {resultLabel(response?.isCorrect)}
                      </span>
                    </div>
                  </div>
                  <p className="mt-3 font-medium leading-snug text-foreground">{gameQuestion.question.questionText}</p>
                  <div className="mt-3 space-y-1 text-sm">
                    <p className="text-muted-foreground">
                      <span className="font-medium text-foreground">You:</span>{' '}
                      {response?.submittedAnswer?.trim() || 'No answer submitted'}
                    </p>
                    <p
                      style={{
                        ...answerHeadingStyle,
                        color: correct ? 'var(--game-correct)' : 'var(--brand-ink)',
                      }}
                    >
                      {gameQuestion.question.answerText}
                    </p>
                  </div>
                  {briefForDisplay ? (
                    <div className="mt-4 text-sm leading-6 text-foreground">
                      <p style={kickerStyle}>Why.</p>
                      {hasDistinctFull ? (
                        <details className="mt-1" open={outcome !== 'correct'}>
                          <summary className="cursor-pointer list-none font-medium leading-6 text-foreground [&::-webkit-details-marker]:hidden">
                            {briefForDisplay}
                          </summary>
                          <p className="mt-2 leading-6 text-foreground">{full}</p>
                        </details>
                      ) : (
                        <p className="mt-1 font-medium leading-6 text-foreground">{briefForDisplay}</p>
                      )}
                    </div>
                  ) : null}
                  {(() => {
                    const note = pickCreatorNote({
                      isHuman: Boolean(authorName),
                      authorName,
                      creatorNote: authorNote,
                    })
                    return note ? <CreatorNote text={note.text} provenance={note.provenance} /> : null
                  })()}
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
                    <AnsweredRowActions
                      target={{ questionId: gameQuestion.questionId }}
                      surface="round_recap"
                    />
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      <section className="card mt-4 px-5 py-4">
        <h2 style={titleStyle}>Your Impact Recap</h2>
        <p className="mt-3 text-sm leading-6 text-[var(--text)]">
          {impactCount > 0
            ? `${impactCount} of your questions were answered correctly this round.`
            : 'None of your questions were answered correctly this season.'}
        </p>
      </section>

      {overlapPlayers ? (
        <div className="mt-6">
          <OverlapMap
            players={[overlapPlayers[0], overlapPlayers[1]]}
            cells={overlapCells}
          />
        </div>
      ) : null}

      <Link className="btn-ghost mt-4" href="/">Back to Home</Link>

      {viewerHasPlayed ? <FirstGameRecapGate gameId={id} /> : null}
    </main>
  );
}
