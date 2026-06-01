'use client';

/**
 * QuestionBankPicker — surfaces the user's existing question bank
 * in contribution flows (PRD v10.5 §8.15).
 * Shows existing questions first; allows adding a new one inline.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { categoryLabel } from '@/lib/questions-types';
import type { QuestionRecord } from '@/lib/questions-types';

type Props = {
  /** Called when the user selects existing questions to contribute */
  onSelect: (questionIds: string[]) => void;
  /** Lets parent flows cache the loaded bank rows for later selected-card rendering */
  onQuestionsLoaded?: (questions: QuestionRecord[]) => void;
  /** Max questions the user can contribute in this flow */
  maxSelect?: number;
  /** IDs already selected/contributed */
  preselectedIds?: string[];
};

export function QuestionBankPicker({
  onSelect,
  onQuestionsLoaded,
  maxSelect = 5,
  preselectedIds = [],
}: Props) {
  const [questions, setQuestions] = useState<QuestionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set(preselectedIds));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/questions')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((data: unknown) => {
        const d = data as { questions?: QuestionRecord[] };
        if (d && Array.isArray(d.questions)) {
          setQuestions(d.questions);
          onQuestionsLoaded?.(d.questions);
        } else if (Array.isArray(data)) {
          const rows = data as QuestionRecord[];
          setQuestions(rows);
          onQuestionsLoaded?.(rows);
        } else {
          throw new Error('Unexpected response');
        }
      })
      .catch(() => setError('Could not load your question bank'))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        if (next.size >= maxSelect) return prev; // budget exceeded
        next.add(id);
      }
      onSelect(Array.from(next));
      return next;
    });
  };

  if (loading) {
    return (
      <p className="font-mono text-xs text-[var(--text-muted)] uppercase">
        Loading your questions…
      </p>
    );
  }

  if (error) {
    return <p className="text-sm text-[var(--wrong)]">{error}</p>;
  }

  return (
    <div>
      <p className="mb-3 text-sm text-[var(--text-muted)]">
        Pick up to {maxSelect} questions from your bank to contribute.
        {selected.size > 0 && (
          <span className="ml-2 font-mono text-xs text-[var(--primary)] uppercase">
            {selected.size} selected
          </span>
        )}
      </p>

      {questions.length === 0 ? (
        <div className="card p-4 text-center">
          <p className="text-sm text-[var(--text-muted)]">Your question bank is empty.</p>
          <Link
            href="/questions"
            className="mt-2 inline-block font-mono text-xs text-[var(--primary)] uppercase hover:underline"
          >
            Add questions first
          </Link>
        </div>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {questions.map((q) => {
            const isSelected = selected.has(q.id);
            const isDisabled = !isSelected && selected.size >= maxSelect;
            return (
              <li key={q.id}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded border p-3 transition-colors ${
                    isSelected
                      ? 'border-[var(--primary)] bg-[var(--primary)]/5'
                      : isDisabled
                        ? 'cursor-not-allowed border-[var(--border)] bg-[var(--card-bg)] opacity-50'
                        : 'border-[var(--border)] bg-[var(--card-bg)] hover:border-[var(--primary)]/50'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    disabled={isDisabled}
                    onChange={() => toggle(q.id)}
                    className="mt-0.5 shrink-0 accent-[var(--primary)]"
                  />
                  <div className="min-w-0">
                    {q.short_label && (
                      <p className="text-sm font-semibold text-[var(--text)]">{q.short_label}</p>
                    )}
                    <p className={`text-sm text-[var(--text${q.short_label ? '-muted' : ''})]`}>
                      {q.question_text.length > 80
                        ? q.question_text.slice(0, 80) + '…'
                        : q.question_text}
                    </p>
                    <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)] uppercase">
                      {categoryLabel(q.category)}
                      {' · '}
                      {q.isOwnAuthored ? 'Written by you' : `From ${q.authorName ?? 'a friend'}`}
                    </p>
                  </div>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
