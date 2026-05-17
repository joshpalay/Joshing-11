'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import { GameplayChatThread } from '@/components/play/GameplayChat';
import { useCatchupFlow } from '@/components/play/useCatchupFlow';
import {
  CATCH_UP_COMPLETION_COPY,
  CATCH_UP_EMPTY_COPY,
  CATCH_UP_POINTS_CAPTION,
} from '@/server/play/catch-up-copy';

export default function DailyCatchupPage() {
  const router = useRouter();
  const {
    currentItem,
    initialTotal,
    introCopy,
    messages,
    loading,
    submitting,
    isResolvingTurn,
    error,
    stats,
    completed,
    remainingLabel,
    reload,
    submitCurrent,
    skipCurrent,
    dismissCurrent,
  } = useCatchupFlow();
  const [answer, setAnswer] = useState('');
  const [introVisible, setIntroVisible] = useState(true);
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);

  const hasItems = initialTotal > 0;
  const caughtUpCount = stats.answered;

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
        <nav className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">
          <button type="button" onClick={() => router.push('/')} className="underline-offset-4 hover:underline">
            Home
          </button>
          <span className="px-1.5">/</span>
          <span>Catch up</span>
        </nav>
        <div className="mt-2 flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.12em] text-[var(--text-muted)]">Catch up</p>
            <h1 className="font-serif text-xl font-semibold text-[var(--text)]">
              {loading
                ? 'Missed questions'
                : `${initialTotal} missed ${initialTotal === 1 ? 'question' : 'questions'} from the past week`}
            </h1>
          </div>
          {!loading && hasItems ? (
            <p className="shrink-0 text-right text-[0.65rem] font-medium uppercase tracking-[0.1em] text-[var(--text-muted)]">
              {remainingLabel}
            </p>
          ) : null}
        </div>
      </header>

      <section className="flex-1 overflow-y-auto px-4 py-4" style={{ paddingBottom: currentItem ? '190px' : '48px' }}>
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
        ) : completed ? (
          <div
            className="mt-10 rounded-[var(--radius-md)] border p-5 text-center"
            style={{
              borderColor: 'color-mix(in srgb, var(--success) 36%, var(--border))',
              background: 'color-mix(in srgb, var(--success) 8%, var(--surface-2))',
            }}
          >
            <p className="text-[0.62rem] font-medium uppercase tracking-[0.12em] text-[var(--success)]">
              All handled
            </p>
            <h2 className="mt-2 font-serif text-2xl font-semibold text-[var(--text)]">{CATCH_UP_COMPLETION_COPY}</h2>
            <p className="mt-3 text-sm text-[var(--text-muted)]">
              {caughtUpCount} caught up - {stats.correct} correct - {stats.dismissed} dismissed
            </p>
            <button type="button" className="btn-primary mt-5" onClick={() => router.push('/')}>
              Back home
            </button>
          </div>
        ) : (
          <>
            {introVisible ? (
              <div
                className="mb-4 rounded-[var(--radius-md)] border p-3"
                style={{
                  borderColor: 'color-mix(in srgb, var(--accent) 22%, var(--border))',
                  background: 'color-mix(in srgb, var(--accent) 6%, var(--surface-2))',
                }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm leading-6 text-[var(--text)]">{introCopy}</p>
                    <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{CATCH_UP_POINTS_CAPTION}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIntroVisible(false)}
                    aria-label="Dismiss intro"
                    className="grid size-8 shrink-0 place-items-center rounded-md border text-sm text-[var(--text-muted)]"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    x
                  </button>
                </div>
              </div>
            ) : null}
            <GameplayChatThread messages={messages} />
            {currentItem ? (
              <div className="mt-1 pl-0.5">
                <button
                  type="button"
                  className="text-xs text-[var(--text-muted)] underline underline-offset-4 disabled:opacity-50"
                  disabled={submitting || isResolvingTurn}
                  onClick={() => setConfirmingDismiss(true)}
                >
                  Not interested
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>

      {currentItem && !loading && !completed ? (
        <form
          className="fixed inset-x-0 bottom-16 z-30 mx-auto max-w-lg border-t px-4 py-3 md:bottom-0"
          style={{
            borderColor: 'var(--border)',
            background: 'color-mix(in srgb, var(--surface) 94%, transparent)',
            backdropFilter: 'blur(8px)',
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
              {submitting ? '...' : 'Send'}
            </button>
          </div>
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              className="text-xs font-medium uppercase tracking-[0.08em] text-[var(--text-muted)] underline-offset-4 hover:underline disabled:opacity-50"
              disabled={submitting || isResolvingTurn}
              onClick={skipCurrent}
            >
              I give up
            </button>
          </div>
        </form>
      ) : null}

      {confirmingDismiss ? (
        <div className="fixed inset-0 z-50 flex items-end bg-black/35 px-4 py-5" role="dialog" aria-modal="true">
          <div className="mx-auto w-full max-w-md rounded-[var(--radius-md)] border bg-[var(--surface)] p-4 shadow-lg" style={{ borderColor: 'var(--border)' }}>
            <h2 className="font-serif text-lg font-semibold text-[var(--text)]">Drop this from catch-up?</h2>
            <p className="mt-1 text-sm leading-6 text-[var(--text-muted)]">
              It will stop appearing in this catch-up list.
            </p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                className="btn-primary flex-1"
                disabled={submitting}
                onClick={async () => {
                  setConfirmingDismiss(false);
                  await dismissCurrent('not_interested');
                }}
              >
                Yes, drop it
              </button>
              <button type="button" className="btn-ghost flex-1" disabled={submitting} onClick={() => setConfirmingDismiss(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
