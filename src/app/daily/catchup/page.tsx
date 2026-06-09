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
        <div className="flex items-center justify-between gap-3">
          <nav className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
            <button type="button" onClick={() => router.push('/')} className="underline-offset-4 hover:underline">
              Home
            </button>
            <span className="px-1.5">/</span>
            <span>Catch up</span>
          </nav>
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
    <div className="mt-1">
      <header className="mb-4">
        <p className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-[var(--success)]">Round complete</p>
        <h2 className="mt-2 font-serif text-2xl font-semibold text-[var(--text)]">How you did</h2>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          {correct}/{total} correct
          {hasMore ? ` - ${remainingCount} still to catch up` : ''}
        </p>
      </header>

      <div className="space-y-3">
        {records.map((record, index) => (
          <RoundRecapCard key={`${record.questionId}-${index}`} record={record} />
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {hasMore ? (
          <button type="button" className="btn-primary" onClick={onPlayNext}>
            Play the next {nextBatchSize}
          </button>
        ) : null}
        <button type="button" className={hasMore ? 'btn-ghost' : 'btn-primary'} onClick={onHome}>
          Return home
        </button>
      </div>
    </div>
  );
}

const RECAP_TONE = {
  correct: {
    label: 'CORRECT',
    border: 'color-mix(in srgb, var(--success) 30%, var(--border))',
    background: 'color-mix(in srgb, var(--success) 8%, var(--surface-2))',
    accent: 'var(--success)',
  },
  wrong: {
    label: 'WRONG',
    border: 'color-mix(in srgb, var(--danger) 28%, var(--border))',
    background: 'color-mix(in srgb, var(--danger) 7%, var(--surface-2))',
    accent: 'var(--danger)',
  },
  revealed: {
    label: 'REVEALED',
    border: 'var(--border)',
    background: 'var(--surface-2)',
    accent: 'var(--text-muted)',
  },
} as const;

function RoundRecapCard({ record }: { record: CatchupBatchRecord }) {
  const tone = RECAP_TONE[record.outcome];
  const yourAnswer = record.outcome === 'revealed'
    ? 'You asked to see the answer'
    : record.submittedAnswer?.trim() || 'No answer submitted';

  return (
    <article
      className="rounded-[var(--radius-md)] border p-4"
      style={{ borderColor: tone.border, background: tone.background, borderLeft: `3px solid ${tone.accent}` }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-sm border px-2 py-1 text-[0.6rem] font-semibold uppercase tracking-[0.08em]"
          style={{ borderColor: tone.border, color: tone.accent }}
        >
          {tone.label}
        </span>
        <span className="text-[0.6rem] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
          {record.authorName ? `From ${record.authorName}` : record.domainDisplayName}
        </span>
      </div>

      <p className="mt-3 font-medium leading-snug text-[var(--text)]">{record.questionText}</p>

      <div className="mt-3 space-y-1 text-sm text-[var(--text-muted)]">
        <p>
          <span className="font-medium text-[var(--text)]">You:</span> {yourAnswer}
        </p>
        <p>
          <span className="font-medium text-[var(--text)]">Answer:</span> {record.correctAnswer || 'No answer available'}
        </p>
      </div>

      {record.explanation ? (
        <p className="mt-3 rounded-[var(--radius-sm)] px-3 py-2 text-sm leading-6 text-[var(--text-muted)]" style={{ background: 'color-mix(in srgb, var(--border) 18%, var(--surface))' }}>
          {record.explanation}
        </p>
      ) : null}
      {/* The fuller creator note the live thread defers to keep its momentum —
          surfaced here in the recap so it is never lost. */}
      {record.authorNote ? (
        <p className="mt-3 rounded-[var(--radius-sm)] border p-3 text-sm leading-6 text-[var(--text)]" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--border) 12%, var(--surface))' }}>
          <span className="font-medium">
            {record.authorIsHouse
              ? 'Editor’s note:'
              : record.authorName
                ? `Why ${record.authorName} asked:`
                : 'Why they asked:'}
          </span>{' '}
          {record.authorNote}
        </p>
      ) : null}
    </article>
  );
}
