'use client';

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';

import { isTooBroadInterest } from '@/lib/knowledge/interest-specificity';

export type AddTopicCandidate = { label: string; broadCategory?: string | null };

// Callers throw this from onAdd so the field can react to known persistence
// outcomes: re-expand on a too-broad backstop, or show the cap affordance.
export type AddTopicError = Error & { code?: 'limit_reached' | 'too_broad' };

type AddTopicFieldProps = {
  /** Persist the chosen topic. Throw an AddTopicError to signal a known outcome. */
  onAdd: (topic: AddTopicCandidate) => Promise<void>;
  /** Existing labels for case-insensitive dedup. */
  existingLabels?: string[];
  heading?: string;
  placeholder?: string;
  maxLength?: number;
  disabled?: boolean;
  /** Rendered after the error text when the interest cap is reached. */
  limitReachedNode?: ReactNode;
  /** Lets a parent focus the input (e.g. a "create your own" CTA). */
  inputRef?: RefObject<HTMLInputElement | null>;
};

/**
 * Shared "add a topic" field. Type a topic and Add it; if it's a broad category
 * ("Technology", "Music") it expands into specific, passion-level choices to pick
 * from instead of saving the bucket. The caller owns persistence via onAdd, so
 * the same field backs onboarding, daily setup, the knowledge modal, and top-up.
 */
export function AddTopicField({
  onAdd,
  existingLabels,
  heading,
  placeholder = 'e.g. Byzantine Coinage',
  maxLength = 80,
  disabled = false,
  limitReachedNode,
  inputRef,
}: AddTopicFieldProps) {
  const inputId = useId();
  const internalRef = useRef<HTMLInputElement | null>(null);
  const ref = inputRef ?? internalRef;

  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitReached, setLimitReached] = useState(false);
  const [candidates, setCandidates] = useState<AddTopicCandidate[] | null>(null);
  const [expandedFrom, setExpandedFrom] = useState<string | null>(null);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);

  const isDuplicate = useCallback(
    (label: string) =>
      (existingLabels ?? []).some(
        (existing) => existing.trim().toLowerCase() === label.trim().toLowerCase(),
      ),
    [existingLabels],
  );

  const expand = useCallback(
    async (topic: string) => {
      setBusy(true);
      setError(null);
      setLimitReached(false);
      setCandidates(null);
      setExpandedFrom(null);
      setPendingLabel(null);
      try {
        const response = await fetch('/api/interests/expand', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ topic }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.message ?? 'Could not break that down.');
        const list: AddTopicCandidate[] = Array.isArray(body?.candidates) ? body.candidates : [];
        const fresh = list.filter(
          (candidate) =>
            typeof candidate?.label === 'string' &&
            candidate.label.trim() &&
            !isDuplicate(candidate.label),
        );
        if (fresh.length === 0) {
          setError(
            `“${topic}” is a whole category. Try something more specific — a person, era, scene, or work.`,
          );
        } else {
          setCandidates(fresh);
          setExpandedFrom(topic);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not break that down.');
      } finally {
        setBusy(false);
      }
    },
    [isDuplicate],
  );

  const commit = useCallback(
    async (candidate: AddTopicCandidate) => {
      const label = candidate.label.trim();
      if (!label || busy) return;
      if (isDuplicate(label)) {
        setError('You already added that one.');
        return;
      }
      setBusy(true);
      setError(null);
      setLimitReached(false);
      setPendingLabel(label);
      try {
        await onAdd({ label, broadCategory: candidate.broadCategory ?? null });
        setValue('');
        setCandidates((prev) => {
          if (!prev) return prev;
          const next = prev.filter(
            (item) => item.label.trim().toLowerCase() !== label.toLowerCase(),
          );
          return next.length > 0 ? next : null;
        });
      } catch (caught) {
        const coded = caught as AddTopicError;
        if (coded?.code === 'too_broad') {
          await expand(label);
          return;
        }
        if (coded?.code === 'limit_reached') setLimitReached(true);
        setError(caught instanceof Error ? caught.message : 'Could not add that topic.');
      } finally {
        setBusy(false);
        setPendingLabel(null);
      }
    },
    [busy, isDuplicate, onAdd, expand],
  );

  const submit = useCallback(async () => {
    if (busy || disabled) return;
    const label = value.trim();
    if (!label) return;
    if (isDuplicate(label)) {
      setError('You already added that one.');
      return;
    }
    if (isTooBroadInterest(label)) {
      await expand(label);
      return;
    }
    await commit({ label });
  }, [busy, disabled, value, isDuplicate, expand, commit]);

  return (
    <div>
      {heading ? (
        <label
          htmlFor={inputId}
          className="block font-serif text-2xl font-semibold text-[var(--ink)]"
        >
          {heading}
        </label>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className={heading ? 'mt-4' : undefined}
      >
        <div className="flex gap-2">
          <input
            ref={ref}
            id={inputId}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            maxLength={maxLength}
            autoComplete="off"
            disabled={disabled}
            className="min-h-12 flex-1 rounded-full border border-[var(--border-warm)] bg-[var(--cream)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--text-muted-warm)]/60 focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60"
          />
          <button
            type="submit"
            className="btn-ghost min-h-12 px-5"
            disabled={disabled || busy || !value.trim()}
          >
            {busy ? 'Working…' : 'Add'}
          </button>
        </div>
      </form>

      {candidates ? (
        <div className="mt-4">
          <p className="text-sm text-[var(--text-muted-warm)]">
            {expandedFrom
              ? `“${expandedFrom}” is a whole category — pick what you’re into:`
              : 'Pick what you’re into:'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {candidates.map((candidate) => (
              <button
                key={candidate.label}
                type="button"
                onClick={() => void commit(candidate)}
                disabled={busy}
                className="rounded-full border border-[var(--border-warm)] bg-[var(--cream)] px-3 py-1.5 text-sm text-[var(--ink)] transition-colors hover:bg-[var(--cream-warm)] disabled:opacity-50"
              >
                {pendingLabel === candidate.label.trim() ? 'Adding…' : candidate.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="text-destructive mt-3 text-sm">
          {error}
          {limitReached && limitReachedNode ? <> {limitReachedNode}</> : null}
        </p>
      ) : null}
    </div>
  );
}

export default AddTopicField;
