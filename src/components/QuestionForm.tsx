'use client';

import Link from 'next/link';
import { useState, useEffect, useRef } from 'react';
import {
  CATEGORIES,
  QUESTION_TYPES,
  categoryLabel,
} from '@/lib/questions-types';
import { validateBreadcrumbContext } from '@/lib/breadcrumb-validation';

export type QuestionFormValues = {
  question_text: string;
  answer_text: string;
  breadcrumb_context: string;
  short_label: string;
  accepted_alternatives: string; // comma-separated
  category: string;
  visibility: string;
  creator_note: string;
  question_type: string;
  answer_source: string;
  minimum_required: string;
  category_overridden: boolean;
  difficulty_estimate: string;
  tags: string; // comma-separated
};

const defaultValues: QuestionFormValues = {
  question_text: '',
  answer_text: '',
  breadcrumb_context: '',
  short_label: '',
  accepted_alternatives: '',
  category: 'other',
  visibility: 'public',
  creator_note: '',
  question_type: 'factual',
  answer_source: '',
  minimum_required: '',
  category_overridden: false,
  difficulty_estimate: '',
  tags: '',
};

type AnswerSuggestion = {
  type: 'factual' | 'personal' | 'ambiguous' | 'factual_uncertain';
  suggested_answer: string | null;
  note: string | null;
  is_list: boolean;
  min_list_items: number | null;
  difficulty_estimate: 'accessible' | 'moderate' | 'specialist' | null;
  suggested_phrasings?: string[];
};

type Props = {
  initialValues?: Partial<QuestionFormValues>;
  onSubmit: (values: QuestionFormValues) => Promise<void>;
  submitLabel: string;
  loadingLabel?: string;
};

export function QuestionForm({
  initialValues,
  onSubmit,
  submitLabel,
  loadingLabel = 'Saving…',
}: Props) {
  const [values, setValues] = useState<QuestionFormValues>({
    ...defaultValues,
    ...initialValues,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<AnswerSuggestion | null>(null);
  const [suggestionLoading, setSuggestionLoading] = useState(false);
  const suggestionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSuggestedFor = useRef<string>('');

  // Fire suggestion after 1s of inactivity on question field (PRD Prompt 4)
  useEffect(() => {
    const q = values.question_text.trim();
    if (suggestionTimer.current) clearTimeout(suggestionTimer.current);
    if (q.length < 5 || q === lastSuggestedFor.current) return;
    suggestionTimer.current = setTimeout(async () => {
      lastSuggestedFor.current = q;
      setSuggestionLoading(true);
      try {
        const res = await fetch('/api/questions/suggest-answer', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: q }),
        });
        if (res.ok) {
          const data = await res.json() as AnswerSuggestion;
          setSuggestion(data);
        }
      } catch {
        // silent — creator writes their own answer
      } finally {
        setSuggestionLoading(false);
      }
    }, 1000);
    return () => {
      if (suggestionTimer.current) clearTimeout(suggestionTimer.current);
    };
  }, [values.question_text]);

  const acceptSuggestion = () => {
    if (!suggestion?.suggested_answer) return;
    setValues((v) => ({
      ...v,
      answer_text: suggestion.suggested_answer!,
      answer_source: 'llm_suggested',
      question_type: suggestion.type === 'personal' ? 'personal'
        : suggestion.type === 'ambiguous' ? 'ambiguous'
        : 'factual',
      difficulty_estimate: suggestion.difficulty_estimate ?? '',
    }));
    setSuggestion(null);
  };

  const acceptPhrasing = (phrasing: string) => {
    setValues((v) => ({ ...v, question_text: phrasing }));
    setSuggestion(null);
    lastSuggestedFor.current = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    const computedBreadcrumb = values.breadcrumb_context.trim();
    const bcErr = validateBreadcrumbContext(computedBreadcrumb);
    if (bcErr) {
      setError(bcErr);
      return;
    }
    setLoading(true);
    try {
      await onSubmit({ ...values, breadcrumb_context: computedBreadcrumb });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <div
          className="rounded-[var(--radius-md)] border px-4 py-3 text-[var(--danger)]"
          style={{ borderColor: 'var(--danger)', background: 'color-mix(in srgb, var(--danger) 12%, var(--bg))' }}
        >
          {error}
        </div>
      )}

      <div>
        <label htmlFor="short_label" className="mb-1 block font-mono text-xs uppercase text-[var(--text-muted)]">
          Short label <span className="normal-case text-[var(--text-muted)]/80">(optional — for quick scanning)</span>
        </label>
        <input
          id="short_label"
          type="text"
          value={values.short_label}
          onChange={(e) => setValues((v) => ({ ...v, short_label: e.target.value }))}
          maxLength={80}
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
          style={{ boxShadow: 'var(--shadow-paper-rest)' }}
          placeholder="e.g. Snorlax Question, The Bucephalus one"
        />
      </div>

      <div>
        <label htmlFor="question_text" className="mb-1 block font-mono text-xs uppercase text-[var(--text-muted)]">
          Question
        </label>
        <textarea
          id="question_text"
          required
          rows={3}
          value={values.question_text}
          onChange={(e) => {
            setValues((v) => ({ ...v, question_text: e.target.value }));
            setSuggestion(null);
          }}
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
          style={{ boxShadow: 'var(--shadow-paper-rest)' }}
          placeholder="e.g. What is the name of Alexander the Great's horse?"
        />
      </div>

      <div>
        <label htmlFor="answer_text" className="mb-1 block font-mono text-xs uppercase text-[var(--text-muted)]">
          Answer
        </label>
        <input
          id="answer_text"
          type="text"
          required
          value={values.answer_text}
          onChange={(e) => setValues((v) => ({ ...v, answer_text: e.target.value, answer_source: 'creator_written' }))}
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
          style={{ boxShadow: 'var(--shadow-paper-rest)' }}
          placeholder="e.g. Bucephalus"
        />

        {/* Accepted alternatives */}
        <div className="mt-3">
          <label htmlFor="accepted_alternatives" className="mb-1 block font-mono text-xs uppercase text-[var(--text-muted)]">
            Also accept <span className="normal-case text-[var(--text-muted)]/80">(optional — comma-separated)</span>
          </label>
          <input
            id="accepted_alternatives"
            type="text"
            value={values.accepted_alternatives}
            onChange={(e) => setValues((v) => ({ ...v, accepted_alternatives: e.target.value }))}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
            style={{ boxShadow: 'var(--shadow-paper-rest)' }}
            placeholder="e.g. Alex's horse, The horse of Alexander"
          />
          <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
            Answers that should also be marked correct — separate with commas
          </p>
        </div>

        {/* Answer not checked warning — shown when user has manually written/overridden the answer */}
        {values.answer_source === 'creator_written' && values.answer_text && (
          <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">
            Answer not checked — double-check before saving
          </p>
        )}

        {/* LLM suggestion */}
        {suggestionLoading && (
          <p className="mt-1 font-mono text-xs text-[var(--text-muted)]">Thinking…</p>
        )}
        {!suggestionLoading && suggestion && (
          <div className="mt-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm">
            {suggestion.suggested_answer ? (
              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[var(--text-muted)]">
                    Suggested: <strong className="text-[var(--text)]">{suggestion.suggested_answer}</strong>
                    {suggestion.type === 'factual_uncertain' && (
                      <span className="ml-1 text-[var(--text-muted)]">(verify)</span>
                    )}
                    {suggestion.difficulty_estimate && (
                      <span className="ml-2 font-mono text-xs uppercase text-[var(--text-muted)]">{suggestion.difficulty_estimate}</span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={acceptSuggestion}
                    className="shrink-0 font-mono text-xs uppercase text-[var(--accent)] hover:underline"
                  >
                    Use this
                  </button>
                </div>
                {suggestion.type === 'factual_uncertain' && suggestion.suggested_phrasings && suggestion.suggested_phrasings.length > 0 && (
                  <div className="mt-2 border-t border-[var(--border)] pt-2">
                    <p className="mb-1.5 font-mono text-xs uppercase text-[var(--text-muted)]">Try a more specific phrasing:</p>
                    <div className="flex flex-col gap-1.5">
                      {suggestion.suggested_phrasings.map((phrasing, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => acceptPhrasing(phrasing)}
                          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-left text-xs text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          style={{ boxShadow: 'var(--shadow-paper-rest)' }}
                        >
                          {phrasing}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : suggestion.note ? (
              <div>
                <p className="text-[var(--text-muted)]">{suggestion.note}</p>
                {suggestion.suggested_phrasings && suggestion.suggested_phrasings.length > 0 && (
                  <div className="mt-2">
                    <p className="mb-1.5 font-mono text-xs uppercase text-[var(--text-muted)]">Try a more specific phrasing:</p>
                    <div className="flex flex-col gap-1.5">
                      {suggestion.suggested_phrasings.map((phrasing, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => acceptPhrasing(phrasing)}
                          className="rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-left text-xs text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)]"
                          style={{ boxShadow: 'var(--shadow-paper-rest)' }}
                        >
                          {phrasing}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        )}
        {/* Show difficulty if already accepted */}
        {values.difficulty_estimate && !suggestion && (
          <p className="mt-1 font-mono text-xs uppercase text-[var(--text-muted)]">
            Difficulty: {values.difficulty_estimate}
          </p>
        )}
      </div>

      {/* Breadcrumb context */}
      <div>
        <label htmlFor="breadcrumb_context" className="mb-1 block font-mono text-xs uppercase text-[var(--text-muted)]">
          Why this is special to you <span className="normal-case text-[var(--text-muted)]/80">(required — up to 6 words)</span>
        </label>
        <input
          id="breadcrumb_context"
          type="text"
          required
          value={values.breadcrumb_context}
          onChange={(e) => setValues((v) => ({ ...v, breadcrumb_context: e.target.value }))}
          maxLength={30}
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
          style={{ boxShadow: 'var(--shadow-paper-rest)' }}
          placeholder="e.g. First concert together, summer '19."
        />
        <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
          Adds the emotional clue behind this question — punctuation is okay
        </p>
        <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
          {values.breadcrumb_context.trim().split(/\s+/).filter(Boolean).length}/6 words · {values.breadcrumb_context.trim().length}/30 characters
        </p>
      </div>

      <div>
        <label htmlFor="tags" className="mb-1 block font-mono text-xs uppercase text-[var(--text-muted)]">
          Tags <span className="normal-case text-[var(--text-muted)]/80">(optional — comma-separated)</span>
        </label>
        <input
          id="tags"
          type="text"
          value={values.tags}
          onChange={(e) => setValues((v) => ({ ...v, tags: e.target.value }))}
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
          style={{ boxShadow: 'var(--shadow-paper-rest)' }}
          placeholder="e.g. pokemon, nintendo, gen-1"
        />
        <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">
          Specific topics — auto-suggested after saving if left blank
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="category" className="mb-1 block font-mono text-xs uppercase text-[var(--text-muted)]">
            Category
          </label>
          <select
            id="category"
            value={values.category}
            onChange={(e) => setValues((v) => ({ ...v, category: e.target.value, category_overridden: true }))}
            className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
            style={{ boxShadow: 'var(--shadow-paper-rest)' }}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {categoryLabel(c)}
              </option>
            ))}
          </select>
          {!values.category_overridden && (
            <p className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">Auto-assigned after saving</p>
          )}
        </div>
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '8px',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.65rem',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
            color: 'var(--text-muted)',
          }}
        >
          <input
            type="checkbox"
            checked={values.visibility === 'private'}
            onChange={(e) =>
              setValues((prev) => ({
                ...prev,
                visibility: e.target.checked ? 'private' : 'public',
              }))}
          />
          Set as private
        </label>
      </div>

      <div>
        <label htmlFor="question_type" className="mb-1 block font-mono text-xs uppercase text-[var(--text-muted)]">
          Question type
        </label>
        <select
          id="question_type"
          value={values.question_type}
          onChange={(e) => setValues((v) => ({ ...v, question_type: e.target.value }))}
          className="w-full rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[var(--text)]"
          style={{ boxShadow: 'var(--shadow-paper-rest)' }}
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap items-center gap-6">
        <button type="submit" disabled={loading} className="btn-primary">
          {loading ? loadingLabel : submitLabel}
        </button>
        <Link
          href="/questions"
          className="font-mono text-sm uppercase text-[var(--text-muted)] hover:underline"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
