'use client';

import Link from 'next/link';
import type { CSSProperties } from 'react';

import type { ReplayItem } from '@/server/replay/session';

export type ReplaySessionResult = {
  item: ReplayItem;
  submitted: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string | null;
};

type Props = {
  results: ReplaySessionResult[];
  hasMore: boolean;
  onPlayNext: () => void;
  loadingNext: boolean;
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

export function ReplaySummary({ results, hasMore, onPlayNext, loadingNext }: Props) {
  const total = results.length;
  const correct = results.filter((result) => result.isCorrect).length;

  return (
    <section className="mt-5">
      <header>
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>Practice Recap</p>
        <h2
          style={{
            marginTop: '6px',
            fontFamily: 'var(--font-neutral), system-ui, sans-serif',
            fontSize: '1.45rem',
            fontWeight: 700,
            color: '#111111',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          How You Did
        </h2>
      </header>

      <div
        className="mt-4 rounded-md border px-5 py-5"
        style={{
          background: 'color-mix(in srgb, var(--game-correct) 10%, var(--surface))',
          borderColor: 'color-mix(in srgb, var(--game-correct) 22%, var(--border))',
        }}
      >
        <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>This round</p>
        <p className="mt-2 font-mono text-5xl font-bold leading-none text-[var(--warm-ink)]">
          {correct}<span className="text-3xl text-[var(--text-muted)]">/{total}</span>
        </p>
        <p style={{ ...monoStyle, marginTop: '12px', color: 'var(--text-muted)' }}>
          correct · practice only
        </p>
      </div>

      <h3 className="mt-6" style={titleStyle}>Round Recap</h3>
      <div className="mt-3 space-y-3">
        {results.map(({ item, submitted, isCorrect, correctAnswer, explanation }) => (
          <article key={item.dailyQueueItemId} className="card p-4">
            <div className="flex items-start justify-between gap-3">
              <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
                {item.domainDisplayName} · originally missed {item.queueDate}
              </p>
              <span
                className={`rounded-sm border px-2 py-1 text-[0.65rem] font-semibold uppercase tracking-[0.08em] ${
                  isCorrect
                    ? 'border-[color-mix(in_srgb,var(--game-correct)_30%,var(--border))] bg-[color-mix(in_srgb,var(--game-correct)_10%,var(--card))] text-[var(--game-correct)]'
                    : 'border-[color-mix(in_srgb,var(--game-wrong)_28%,var(--border))] bg-[color-mix(in_srgb,var(--game-wrong)_8%,var(--card))] text-[var(--game-wrong)]'
                }`}
              >
                {isCorrect ? 'CORRECT' : 'WRONG'}
              </span>
            </div>
            <p className="mt-3 font-medium leading-snug text-[var(--text)]">{item.questionText}</p>
            <div className="mt-3 space-y-1 text-sm">
              <p className="text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text)]">You:</span>{' '}
                {submitted.trim() || 'No answer submitted'}
              </p>
              <p className="text-[var(--text-muted)]">
                <span className="font-medium text-[var(--text)]">Answer:</span> {correctAnswer}
              </p>
            </div>
            {explanation ? (
              <p className="mt-3 text-sm leading-6 text-[var(--text-muted)]">{explanation}</p>
            ) : null}
          </article>
        ))}
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {hasMore ? (
          <button
            type="button"
            className="btn-primary"
            onClick={onPlayNext}
            disabled={loadingNext}
          >
            {loadingNext ? 'Loading…' : 'Play next 5'}
          </button>
        ) : null}
        <Link href="/" className="btn-ghost">Back home</Link>
      </div>

      {!hasMore ? (
        <p className="mt-3 text-sm text-[var(--text-muted)]">
          Nothing left to practice right now.
        </p>
      ) : null}
    </section>
  );
}
