'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { visibleFeedCategory } from './category';

type AnswerSheetProps = {
  question: string;
  category?: string | null;
  onSubmit: (answer: string) => void;
  onClose: () => void;
  loading?: boolean;
  // Warm, non-alarming progress note shown while a transient grader outage is
  // being auto-retried (the answer hasn't been scored — nothing went wrong).
  statusMessage?: string | null;
  // Terminal failure shown once auto-retries are spent ("try again later").
  errorMessage?: string | null;
};

export function AnswerSheet({
  question,
  category,
  onSubmit,
  onClose,
  loading = false,
  statusMessage = null,
  errorMessage = null,
}: AnswerSheetProps) {
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const visibleCategory = visibleFeedCategory(category);

  useEffect(() => {
    const timer = setTimeout(() => inputRef.current?.focus(), 80);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || loading) return;
    onSubmit(trimmed);
  };

  return (
    <div className="fixed inset-0 z-[var(--z-sheet)] flex items-end justify-center">
      <button
        type="button"
        className="absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-label="Dismiss"
      />
      <div className="relative w-full max-w-lg rounded-t-3xl bg-[var(--brand-card)] shadow-[var(--shadow-overlay)]">
        <div className="flex items-center justify-between px-5 pt-5 pb-2">
          {visibleCategory ? (
            <p className="text-[0.68rem] font-semibold tracking-[0.18em] text-[var(--brand-ink-400)] uppercase">
              {visibleCategory.toUpperCase()}
            </p>
          ) : (
            <div />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="hover:bg-muted hover:text-foreground focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-full text-[var(--brand-ink-400)] transition focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <X className="size-4" />
          </button>
        </div>

        <p className="px-5 pb-5 font-serif text-xl leading-8 text-[var(--brand-ink)]">{question}</p>

        <form onSubmit={handleSubmit} className="px-5 pb-8">
          <label htmlFor={inputId} className="sr-only">
            Your answer
          </label>
          <input
            id={inputId}
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Your answer…"
            disabled={loading}
            autoComplete="off"
            className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] min-h-11 w-full rounded-xl border border-[var(--accent-gold)] px-4 text-base outline-none disabled:opacity-60"
          />
          {statusMessage ? (
            <p
              role="status"
              aria-live="polite"
              className="mt-3 text-sm text-[var(--brand-ink-400)]"
            >
              {statusMessage}
            </p>
          ) : null}
          {errorMessage ? (
            <p role="alert" className="mt-3 text-sm text-[var(--brand-ink-400)]">
              {errorMessage}
            </p>
          ) : null}
          <button
            type="submit"
            disabled={loading || !value.trim()}
            className="btn-primary mt-3 w-full"
          >
            {loading ? 'Grading…' : 'Answer'}
          </button>
        </form>
      </div>
    </div>
  );
}
