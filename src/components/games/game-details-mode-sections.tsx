'use client';

import { type CSSProperties } from 'react';
import Link from 'next/link';

type CompletedRecapHeaderProps = {
  title: string;
  subtitle: string;
  roundsLabel: string;
  highlights: string[];
  seasonHighlights?: Array<{
    id: string;
    label: string;
    prompt: string;
  }>;
};

const monoStyle: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: '0.62rem',
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
};

export function CompletedRecapHeader({
  title,
  subtitle,
  roundsLabel,
  highlights,
  seasonHighlights = [],
}: CompletedRecapHeaderProps) {
  return (
    <section className="card px-5 py-5">
      <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>{subtitle}</p>
      <h2
        style={{
          marginTop: '8px',
          fontFamily: 'var(--font-neutral), system-ui, sans-serif',
          fontSize: '1.2rem',
          fontWeight: 600,
          color: '#111111',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
        }}
      >
        {title}
      </h2>
      <p style={{ marginTop: '10px', fontSize: '0.92rem', color: 'var(--text)' }}>{roundsLabel}</p>
      {highlights.length > 0 ? (
        <ul style={{ marginTop: '10px', paddingLeft: '18px', display: 'grid', gap: '6px' }}>
          {highlights.map((item) => (
            <li key={item} style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              {item}
            </li>
          ))}
        </ul>
      ) : null}
      {seasonHighlights.length > 0 ? (
        <div
          aria-label="Season highlights"
          style={{
            marginTop: '12px',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '8px',
          }}
        >
          {seasonHighlights.map((item) => (
            <article
              key={item.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: '999px',
                padding: '6px 10px',
                maxWidth: '100%',
                background: 'var(--surface)',
              }}
            >
              <p style={{ ...monoStyle, color: 'var(--text-muted)', fontSize: '0.52rem' }}>{item.label}</p>
              <p
                style={{
                  marginTop: '2px',
                  color: 'var(--text)',
                  fontSize: '0.82rem',
                  lineHeight: 1.25,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '260px',
                }}
                title={item.prompt}
              >
                {item.prompt}
              </p>
            </article>
          ))}
        </div>
      ) : null}
    </section>
  );
}

type StandingsRow = {
  id: string;
  name: string;
  correct: number;
  answered: number;
};

export function StandingsCard({ rows }: { rows: StandingsRow[] }) {
  return (
    <section className="card px-5 py-4">
      <h3 style={{ ...monoStyle, color: 'var(--text-muted)' }}>Standings</h3>
      {rows.length === 0 ? (
        <p style={{ marginTop: '10px', color: 'var(--text-muted)', fontSize: '0.9rem' }}>No answers recorded yet.</p>
      ) : (
        <div style={{ marginTop: '12px', display: 'grid', gap: '8px' }}>
          {rows.map((row, index) => (
            <div
              key={row.id}
              style={{
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '10px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '8px',
              }}
            >
              <p style={{ fontSize: '0.9rem', color: 'var(--text)' }}>
                {index + 1}. {row.name}
              </p>
              <p style={{ ...monoStyle, color: 'var(--text-muted)' }}>
                {row.correct}/{row.answered}
              </p>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

type QuestionHistoryFilter = 'all' | 'mine' | 'starred';
type QuestionHistoryResultFilter = 'all' | 'correct' | 'wrong' | 'expired' | 'unanswered';
type QuestionHistoryAuthorFilter = 'all' | 'mine' | 'others';

type QuestionHistoryCategoryFilterOption = {
  value: string;
  label: string;
};

export function QuestionHistoryFilters({
  primaryValue,
  onPrimaryChange,
  resultValue,
  onResultChange,
  categoryValue,
  onCategoryChange,
  authorValue,
  onAuthorChange,
  categories,
}: {
  primaryValue: QuestionHistoryFilter;
  onPrimaryChange: (next: QuestionHistoryFilter) => void;
  resultValue: QuestionHistoryResultFilter;
  onResultChange: (next: QuestionHistoryResultFilter) => void;
  categoryValue: string;
  onCategoryChange: (next: string) => void;
  authorValue: QuestionHistoryAuthorFilter;
  onAuthorChange: (next: QuestionHistoryAuthorFilter) => void;
  categories: QuestionHistoryCategoryFilterOption[];
}) {
  const items: QuestionHistoryFilter[] = ['all', 'mine', 'starred'];
  const resultItems: QuestionHistoryResultFilter[] = ['all', 'correct', 'wrong', 'expired', 'unanswered'];
  const authorItems: QuestionHistoryAuthorFilter[] = ['all', 'mine', 'others'];
  return (
    <div style={{ display: 'grid', gap: '8px', marginBottom: '12px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPrimaryChange(item)}
            style={{
              ...monoStyle,
              fontSize: '0.56rem',
              borderRadius: '999px',
              padding: '4px 9px',
              border: '1px solid var(--border)',
              background: primaryValue === item ? 'var(--surface-2)' : 'transparent',
              color: primaryValue === item ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            {item === 'all' ? 'All' : item === 'mine' ? 'My prompts' : 'In bank'}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
        {resultItems.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onResultChange(item)}
            style={{
              ...monoStyle,
              fontSize: '0.52rem',
              borderRadius: '999px',
              padding: '3px 8px',
              border: '1px solid var(--border)',
              background: resultValue === item ? 'var(--surface-2)' : 'transparent',
              color: resultValue === item ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            {item === 'all' ? 'Any result' : item}
          </button>
        ))}
        {authorItems.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onAuthorChange(item)}
            style={{
              ...monoStyle,
              fontSize: '0.52rem',
              borderRadius: '999px',
              padding: '3px 8px',
              border: '1px solid var(--border)',
              background: authorValue === item ? 'var(--surface-2)' : 'transparent',
              color: authorValue === item ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            {item === 'all' ? 'Any author' : item === 'mine' ? 'By me' : 'By others'}
          </button>
        ))}
        {categories.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => onCategoryChange(item.value)}
            style={{
              ...monoStyle,
              fontSize: '0.52rem',
              borderRadius: '999px',
              padding: '3px 8px',
              border: '1px solid var(--border)',
              background: categoryValue === item.value ? 'var(--surface-2)' : 'transparent',
              color: categoryValue === item.value ? 'var(--text)' : 'var(--text-muted)',
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}

type PostGameAction = {
  key: string;
  href: string;
  label: string;
};

export function PostGameActions({
  primary,
  more,
}: {
  primary: PostGameAction | null;
  more: PostGameAction[];
}) {
  return (
    <section className="card px-5 py-4" style={{ display: 'grid', gap: '12px' }}>
      <h3 style={{ ...monoStyle, color: 'var(--text-muted)' }}>Next</h3>
      {primary ? (
        <Link href={primary.href} className="btn-primary" style={{ textAlign: 'center', textDecoration: 'none' }}>
          {primary.label}
        </Link>
      ) : null}
      {more.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 14px', alignItems: 'center' }}>
          {more.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              style={{ ...monoStyle, textDecoration: 'underline', color: 'var(--text-muted)' }}
            >
              {item.label}
            </Link>
          ))}
        </div>
      ) : null}
    </section>
  );
}

export type { QuestionHistoryAuthorFilter, QuestionHistoryCategoryFilterOption, QuestionHistoryFilter, QuestionHistoryResultFilter };
