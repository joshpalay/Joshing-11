'use client';

import { Sparkles } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { CATEGORIES, categoryLabel } from '@/lib/questions-types';

export type QuestionFormValues = {
  text: string;
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string | null;
  domain: string;
  difficulty: number;
};

type SuggestionResponse = {
  correctAnswer: string;
  alternateAnswers: string[];
  explanation: string;
};

type Props = {
  mode?: 'create' | 'edit';
  initialValues?: Partial<QuestionFormValues>;
  onSubmit: (values: QuestionFormValues) => Promise<void>;
  submitLabel?: string;
  loadingLabel?: string;
  onCancel?: () => void;
};


const DIFFICULTY_SCALE: Record<number, { label: string; hint: string }> = {
  1: { label: 'Accessible', hint: 'Most players should be able to get this one.' },
  2: { label: 'Accessible → Moderate', hint: 'Leans approachable but needs some recall.' },
  3: { label: 'Moderate', hint: 'Balanced challenge with topic familiarity.' },
  4: { label: 'Moderate → Specialist', hint: 'Leans advanced and rewards deeper knowledge.' },
  5: { label: 'Specialist', hint: 'Best for enthusiasts or experts in the domain.' },
};

const defaults: QuestionFormValues = {
  text: '',
  correctAnswer: '',
  alternateAnswers: [],
  explanation: '',
  domain: 'other',
  difficulty: 3,
};

function normalizeInitialValues(initialValues?: Partial<QuestionFormValues>): QuestionFormValues {
  return {
    ...defaults,
    ...initialValues,
    alternateAnswers: initialValues?.alternateAnswers ?? defaults.alternateAnswers,
    explanation: initialValues?.explanation ?? defaults.explanation,
  };
}

function validate(values: QuestionFormValues): string | null {
  if (!values.text.trim()) return 'Question text is required.';
  if (values.text.trim().length > 300) return 'Question text must be 300 characters or fewer.';
  if (!values.correctAnswer.trim()) return 'Correct answer is required.';
  if (values.correctAnswer.trim().length > 200) return 'Correct answer must be 200 characters or fewer.';
  if (values.alternateAnswers.length > 5) return 'Use at most 5 alternate answers.';
  if (values.alternateAnswers.some((answer) => answer.length > 200)) return 'Alternate answers must be 200 characters or fewer.';
  if ((values.explanation ?? '').length > 500) return 'Explanation must be 500 characters or fewer.';
  if (!CATEGORIES.includes(values.domain as (typeof CATEGORIES)[number])) return 'Choose a valid domain.';
  if (!Number.isInteger(values.difficulty) || values.difficulty < 1 || values.difficulty > 5) return 'Choose a difficulty from 1 to 5.';
  return null;
}

export function QuestionForm({
  mode = 'create',
  initialValues,
  onSubmit,
  submitLabel,
  loadingLabel = 'Saving...',
  onCancel,
}: Props) {
  const [values, setValues] = useState<QuestionFormValues>(() => normalizeInitialValues(initialValues));
  const [alternateText, setAlternateText] = useState(() => (initialValues?.alternateAnswers ?? []).join(', '));
  const [submitting, setSubmitting] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);

  useEffect(() => {
    setValues(normalizeInitialValues(initialValues));
    setAlternateText((initialValues?.alternateAnswers ?? []).join(', '));
    setError(null);
    setSuggestionError(null);
  }, [initialValues]);

  const resolvedSubmitLabel = submitLabel ?? (mode === 'edit' ? 'Update question' : 'Save question');
  const alternateAnswers = useMemo(
    () => alternateText.split(',').map((answer) => answer.trim()).filter(Boolean).slice(0, 5),
    [alternateText],
  );

  async function requestSuggestion() {
    const questionText = values.text.trim();
    if (!questionText) {
      setSuggestionError('Write the question first.');
      return;
    }

    setSuggesting(true);
    setSuggestionError(null);
    try {
      const response = await fetch('/api/questions/suggest', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionText }),
      });
      const body = await response.json().catch(() => null) as SuggestionResponse | { error?: string } | null;
      if (!response.ok || !body || !('correctAnswer' in body)) throw new Error('Suggestion unavailable');

      setValues((current) => ({
        ...current,
        correctAnswer: current.correctAnswer.trim() ? current.correctAnswer : body.correctAnswer,
        explanation: current.explanation?.trim() ? current.explanation : body.explanation,
      }));
      if (!alternateText.trim() && body.alternateAnswers.length > 0) {
        setAlternateText(body.alternateAnswers.join(', '));
      }
    } catch {
      setSuggestionError('Suggestion unavailable');
    } finally {
      setSuggesting(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextValues = {
      ...values,
      text: values.text.trim(),
      correctAnswer: values.correctAnswer.trim(),
      alternateAnswers,
      explanation: values.explanation?.trim() || null,
    };
    const validationError = validate(nextValues);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(nextValues);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save that question.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {error ? (
        <p className="rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <div>
        <label htmlFor="question-text" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">
          Question
        </label>
        <textarea
          id="question-text"
          value={values.text}
          onChange={(event) => setValues((current) => ({ ...current, text: event.target.value.slice(0, 300) }))}
          rows={4}
          maxLength={300}
          required
          className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus:border-primary"
          placeholder="What is the name of Alexander the Great's horse?"
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">{values.text.length}/300</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void requestSuggestion()}
          disabled={suggesting || !values.text.trim()}
          className="inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"
        >
          <Sparkles className={suggesting ? 'size-4 animate-pulse' : 'size-4'} />
          {suggesting ? 'Suggesting...' : 'Suggest answer'}
        </button>
        {suggestionError ? <span className="text-sm text-destructive">{suggestionError}</span> : null}
      </div>

      <div>
        <label htmlFor="correct-answer" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">
          Correct answer
        </label>
        <input
          id="correct-answer"
          value={values.correctAnswer}
          onChange={(event) => setValues((current) => ({ ...current, correctAnswer: event.target.value.slice(0, 200) }))}
          maxLength={200}
          required
          className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:border-primary"
          placeholder="Bucephalus"
        />
      </div>

      <div>
        <label htmlFor="alternate-answers" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">
          Alternate answers
        </label>
        <input
          id="alternate-answers"
          value={alternateText}
          onChange={(event) => setAlternateText(event.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:border-primary"
          placeholder="Accepted variations, separated by commas"
        />
        <p className="mt-1 text-xs text-muted-foreground">{alternateAnswers.length}/5 alternates</p>
      </div>

      <div>
        <label htmlFor="explanation" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">
          Explanation
        </label>
        <textarea
          id="explanation"
          value={values.explanation ?? ''}
          onChange={(event) => setValues((current) => ({ ...current, explanation: event.target.value.slice(0, 500) }))}
          rows={4}
          maxLength={500}
          className="w-full rounded-md border bg-background px-3 py-2 outline-none focus:border-primary"
          placeholder="A short note that helps someone learn if they miss it."
        />
        <p className="mt-1 text-right text-xs text-muted-foreground">{(values.explanation ?? '').length}/500</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="domain" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">
            Domain
          </label>
          <select
            id="domain"
            value={values.domain}
            onChange={(event) => setValues((current) => ({ ...current, domain: event.target.value }))}
            className="h-11 w-full rounded-md border bg-background px-3 outline-none focus:border-primary"
          >
            {CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {categoryLabel(category)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="difficulty" className="mb-1 block text-xs uppercase tracking-[0.1em] text-muted-foreground">
            Difficulty
          </label>
          <select
            id="difficulty"
            value={values.difficulty}
            onChange={(event) => setValues((current) => ({ ...current, difficulty: Number(event.target.value) }))}
            className="h-11 w-full rounded-md border bg-background px-3 outline-none focus:border-primary"
          >
            {[1, 2, 3, 4, 5].map((difficulty) => (
              <option key={difficulty} value={difficulty}>
                {difficulty} · {DIFFICULTY_SCALE[difficulty].label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-muted-foreground">
            Rank {values.difficulty}/5 — {DIFFICULTY_SCALE[values.difficulty].label}. {DIFFICULTY_SCALE[values.difficulty].hint}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? loadingLabel : resolvedSubmitLabel}
        </button>
        {onCancel ? (
          <button type="button" onClick={onCancel} className="btn-ghost" disabled={submitting}>
            Cancel
          </button>
        ) : null}
      </div>
    </form>
  );
}
