'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

import { GameplayChatThread } from '@/components/play/GameplayChat';
import { useCatchupFlow, type CatchupBatchRecord } from '@/components/play/useCatchupFlow';
import { CATCH_UP_EMPTY_COPY } from '@/server/play/catch-up-copy';

export default function DailyCatchupPage() {
  const router = useRouter();
  const {
    currentItem,
    initialTotal,
    messages,
    loading,
    submitting,
    isResolvingTurn,
    error,
    remainingLabel,
    phase,
    batchRecords,
    remainingCount,
    nextBatchSize,
    startNextBatch,
    reload,
    submitCurrent,
    skipCurrent,
    dismissCurrent,
  } = useCatchupFlow();
  const [answer, setAnswer] = useState('');

  const hasItems = initialTotal > 0;
  const showSummary = phase === 'summary';

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const submitted = answer.trim();
    if (!submitted) return;
    setAnswer('');
    await submitCurrent(submitted);
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col bg-[var(--surface)] px-0">
      <header
        className="sticky top-0 z-20 border-b px-4 py-3"
        style={{
          borderColor: 'var(--border)',
          background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
          backdropFilter: 'blur(8px)',
        }}
      >
        <div className="flex items-center justify-end gap-3">
          <Link
            href="/"
            aria-label="Close"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2"
          >
            <X className="size-5" strokeWidth={1.9} />
          </Link>
        </div>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Catch up</p>
            <h1 className="font-serif text-xl font-semibold text-[var(--text)]">
              {loading
                ? 'Missed questions'
                : `${initialTotal} missed ${initialTotal === 1 ? 'question' : 'questions'} from the past week`}
            </h1>
          </div>
          {!loading && hasItems && !showSummary ? (
            <p className="shrink-0 text-right text-[0.65rem] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {remainingLabel}
            </p>
          ) : null}
        </div>
      </header>

      <section
        className="flex-1 overflow-y-auto px-4 py-4"
        style={{
          paddingBottom: currentItem && !showSummary
            ? 'calc(130px + env(safe-area-inset-bottom))'
            : 'calc(24px + env(safe-area-inset-bottom))',
          // Cream backdrop on the recap so the near-white --brand-card recap cards
          // read against the page, matching the daily Session-recap surface.
          background: showSummary ? 'var(--brand-cream-page)' : undefined,
        }}
      >
        {loading ? (
          <p className="text-sm text-[var(--text-muted)]">Loading catch-up...</p>
        ) : error ? (
          <div
            className="rounded-[var(--radius-sm)] border px-3 py-2 text-sm text-[var(--danger)]"
            style={{ borderColor: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 10%, var(--surface))' }}
          >
            <p>{error}</p>
            <button type="button" className="btn-ghost mt-3" onClick={() => void reload()}>
              Retry
            </button>
          </div>
        ) : !hasItems ? (
          <div className="mt-10 rounded-[var(--radius-md)] border p-5 text-center" style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}>
            <p className="font-serif text-lg text-[var(--text)]">{CATCH_UP_EMPTY_COPY}</p>
            <button type="button" className="btn-primary mt-4" onClick={() => router.push('/')}>
              Back home
            </button>
          </div>
        ) : showSummary ? (
          <RoundSummary
            records={batchRecords}
            remainingCount={remainingCount}
            nextBatchSize={nextBatchSize}
            onPlayNext={startNextBatch}
            onHome={() => router.push('/')}
          />
        ) : (
          <>
            <GameplayChatThread
              messages={messages}
              onGiveUp={() => skipCurrent()}
              giveUpDisabled={submitting || isResolvingTurn}
              onDismiss={() => void dismissCurrent()}
              dismissDisabled={submitting || isResolvingTurn}
            />
          </>
        )}
      </section>

      {currentItem && !loading && !showSummary ? (
        <form
          className="fixed inset-x-0 bottom-0 z-30 mx-auto max-w-lg border-t px-4 py-3"
          style={{
            borderColor: 'var(--border)',
            background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
            backdropFilter: 'blur(8px)',
            paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))',
          }}
          onSubmit={(event) => void handleSubmit(event)}
        >
          <div className="flex gap-2">
            <input
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              disabled={submitting || isResolvingTurn}
              placeholder="Your answer..."
              className="min-h-11 min-w-0 flex-1 rounded-[var(--radius-md)] border bg-[var(--bg)] px-4 text-base text-[var(--text)] outline-none"
              style={{ borderColor: 'var(--border)' }}
            />
            <button type="submit" className="btn-primary shrink-0" disabled={submitting || isResolvingTurn || !answer.trim()}>
              {submitting ? '...' : 'Answer'}
            </button>
          </div>
        </form>
      ) : null}
    </main>
  );
}

// The Play Missed recap mirrors the daily Session-recap visual treatment
// (src/app/daily/summary/page.tsx): the editorial Ink-on-Cream card, a colored
// left accent bar, a status pill, the "You said / Answer" grid, the explainer,
// and the creator's-note block. Both surfaces share the same palette already
// (--surface → --brand-card, --text → --brand-ink); the recap just adopts the
// brand tokens directly so the styling reads as one family.
function RoundSummary({
  records,
  remainingCount,
  nextBatchSize,
  onPlayNext,
  onHome,
}: {
  records: CatchupBatchRecord[];
  remainingCount: number;
  nextBatchSize: number;
  onPlayNext: () => void;
  onHome: () => void;
}) {
  const total = records.length;
  const correct = records.filter((record) => record.outcome === 'correct').length;
  const hasMore = remainingCount > 0;

  return (
    <div className="mx-auto max-w-3xl text-[var(--brand-ink)]">
      <header className="pb-2">
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-[var(--game-correct)]">
          Round complete
        </p>
        <div className="mt-3 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-serif text-[2.25rem] leading-[0.95] tracking-[-0.03em] text-[var(--brand-ink)]">
              How you did
            </h2>
            <p className="mt-3 max-w-xl text-[1.02rem] leading-7 text-[var(--brand-ink-700)]">
              {hasMore
                ? `You worked through ${total}. ${remainingCount} still waiting to be cleared.`
                : 'You cleared the questions you had missed.'}
            </p>
          </div>
          <p
            className="shrink-0 pt-2 text-sm font-medium text-[var(--brand-ink-400)]"
            aria-label={`${correct} out of ${total} correct`}
          >
            {correct} / {total}
          </p>
        </div>
        <div className="mt-5">
          <CatchupResultDots records={records} />
        </div>
      </header>

      <div className="mt-8 space-y-4">
        {records.map((record, index) => (
          <RoundRecapCard key={`${record.questionId}-${index}`} record={record} />
        ))}
      </div>

      <section className="mt-8 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-6 text-center">
        <p className="text-[1.05rem] leading-7 text-[var(--brand-ink-700)]">
          {hasMore
            ? `${remainingCount} still waiting whenever you’re ready.`
            : 'You’re all caught up.'}
        </p>
        <div className="mt-5 flex flex-col items-center gap-3">
          {hasMore ? (
            <button
              type="button"
              className="btn-primary w-full rounded-full sm:w-auto sm:min-w-56"
              onClick={onPlayNext}
            >
              Play the next {nextBatchSize}
            </button>
          ) : null}
          <button
            type="button"
            className={
              hasMore
                ? 'text-muted-foreground text-sm font-medium underline underline-offset-4 transition hover:text-foreground'
                : 'btn-primary w-full rounded-full sm:w-auto sm:min-w-56'
            }
            onClick={onHome}
          >
            Return home
          </button>
        </div>
      </section>
    </div>
  );
}

function CatchupResultDots({ records }: { records: CatchupBatchRecord[] }) {
  return (
    <div className="flex items-center gap-2" aria-label="Question results">
      {records.map((record, index) => (
        <span
          key={`${record.questionId}-${index}`}
          className="size-2.5 rounded-full border"
          style={{
            backgroundColor:
              record.outcome === 'revealed'
                ? 'color-mix(in srgb, var(--brand-ink) 24%, transparent)'
                : record.outcome === 'correct'
                  ? 'color-mix(in srgb, var(--game-correct) 88%, var(--brand-card))'
                  : 'color-mix(in srgb, var(--game-wrong) 78%, var(--brand-card))',
            borderColor: 'color-mix(in srgb, var(--brand-border) 72%, transparent)',
            boxShadow: '0 0 0 2px var(--brand-card)',
          }}
          aria-label={`Question ${index + 1}: ${
            record.outcome === 'revealed'
              ? 'revealed'
              : record.outcome === 'correct'
                ? 'correct'
                : 'not this time'
          }`}
        />
      ))}
    </div>
  );
}

function RoundRecapCard({ record }: { record: CatchupBatchRecord }) {
  const [isExplainerOpen, setIsExplainerOpen] = useState(false);

  const isCorrect = record.outcome === 'correct';
  const isRevealed = record.outcome === 'revealed';
  const statusLabel = isCorrect ? 'Correct' : isRevealed ? 'Revealed' : 'Not this time';
  const accentColor = isRevealed
    ? 'color-mix(in srgb, var(--brand-ink) 26%, var(--brand-card))'
    : isCorrect
      ? 'var(--game-correct)'
      : 'color-mix(in srgb, var(--game-wrong) 76%, var(--brand-card))';
  const yourAnswer = isRevealed
    ? 'You asked to see the answer'
    : record.submittedAnswer?.trim() || 'No answer submitted';
  const creatorNoteLabel = record.authorName
    ? `${record.authorName.split(/\s+/)[0]}’s note`
    : record.authorIsHouse
      ? 'Editor’s note'
      : 'Creator’s note';

  return (
    <article className="relative overflow-hidden rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] p-5 shadow-none">
      <div className="absolute inset-y-0 left-0 w-1" style={{ backgroundColor: accentColor }} />

      <div className="flex flex-wrap items-center gap-2 pl-1">
        <span
          className="rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.05em]"
          style={{
            borderColor: isCorrect
              ? 'color-mix(in srgb, var(--game-correct) 28%, var(--brand-border))'
              : 'var(--brand-border)',
            backgroundColor: isCorrect
              ? 'color-mix(in srgb, var(--game-correct) 8%, var(--brand-card))'
              : 'color-mix(in srgb, var(--brand-cream-page) 62%, var(--brand-card))',
            color: isCorrect ? 'var(--game-correct)' : 'var(--brand-ink-700)',
          }}
        >
          {statusLabel}
        </span>
        <p className="text-xs leading-5 text-[var(--brand-ink-400)]">
          <span>{record.domainDisplayName}</span>
          {record.authorName ? (
            <>
              <span aria-hidden="true"> · </span>
              <span>by {record.authorName}</span>
            </>
          ) : null}
        </p>
      </div>

      <p className="mt-4 pl-1 text-[1.12rem] leading-7 font-medium tracking-[-0.01em] text-[var(--brand-ink)]">
        {record.questionText}
      </p>

      <div className="mt-5 grid gap-3 rounded-md border border-[var(--brand-border)] bg-[var(--brand-cream-page)] p-3 sm:grid-cols-2">
        <div>
          <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            You said
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--brand-ink)]">{yourAnswer}</p>
        </div>
        <div className="border-t border-[var(--brand-border)] pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
          <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Answer
          </p>
          <p
            className="mt-1 text-sm leading-6 font-medium"
            style={{ color: isCorrect ? 'var(--game-correct)' : 'var(--brand-ink)' }}
          >
            {record.correctAnswer || 'No answer available'}
          </p>
        </div>
      </div>

      {record.explanation ? (
        <section className="mt-5 pl-1">
          <h3 className="text-sm font-semibold text-[var(--brand-ink)]">
            Why this is the answer
          </h3>
          <p
            className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]"
            style={
              isExplainerOpen
                ? undefined
                : {
                    display: '-webkit-box',
                    WebkitLineClamp: 3,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }
            }
          >
            {record.explanation}
          </p>
          {!isExplainerOpen ? (
            <button
              type="button"
              onClick={() => setIsExplainerOpen(true)}
              className="mt-2 text-sm font-medium text-[var(--brand-link)] underline underline-offset-4"
            >
              More context →
            </button>
          ) : null}
        </section>
      ) : null}

      {/* The fuller creator note the live thread defers to keep its momentum —
          surfaced here in the recap so it is never lost. */}
      {record.authorNote ? (
        <section className="mt-5 rounded-md border border-[var(--brand-border)] bg-[var(--brand-cream-page)] px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--brand-ink)]">{creatorNoteLabel}</h3>
          <p className="mt-1 text-sm leading-6 text-[var(--brand-ink-700)]">{record.authorNote}</p>
        </section>
      ) : null}
    </article>
  );
}
