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

// One convergence suggestion surfaced before a specific topic is added: an
// existing canonical domain across the game the typed label is close to. Shape
// mirrors POST /api/knowledge/converge.
type ConvergeApiCandidate = {
  label: string;
  broadCategory: string | null;
  kind: 'exact' | 'fuzzy' | 'new';
  similarity: number;
};

// Cream / Ink-on-Cream defaults (the daily-setup surface). Overridable so the
// same field matches differently-themed surfaces (e.g. the top-up modal).
const DEFAULT_INPUT_CLASS =
  'min-h-12 flex-1 rounded-full border border-[var(--border-warm)] bg-[var(--cream)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--text-muted-warm)]/60 focus-visible:ring-2 focus-visible:ring-[var(--ink)] focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-60';
const DEFAULT_BUTTON_CLASS = 'btn-ghost min-h-12 px-5';
const DEFAULT_CHIP_CLASS =
  'rounded-full border border-[var(--border-warm)] bg-[var(--cream)] px-3 py-1.5 text-sm text-[var(--ink)] transition-colors hover:bg-[var(--cream-warm)] disabled:opacity-50';
const DEFAULT_MUTED_CLASS = 'text-sm text-[var(--text-muted-warm)]';
const DEFAULT_ERROR_CLASS = 'text-destructive mt-3 text-sm';

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
  /**
   * Before adding a specific topic, run it through POST /api/knowledge/converge
   * to align it onto an existing canonical domain across the game. An exact
   * match is applied transparently (same domain); fuzzy matches surface as a
   * dismissible "did you mean?" with the typed wording as the alternative.
   * Off by default so surfaces opt in.
   */
  convergeBeforeAdd?: boolean;
  // Style overrides so the field can match each surface's palette.
  className?: string;
  inputClassName?: string;
  buttonClassName?: string;
  chipClassName?: string;
  mutedClassName?: string;
  errorClassName?: string;
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
  convergeBeforeAdd = false,
  className,
  inputClassName = DEFAULT_INPUT_CLASS,
  buttonClassName = DEFAULT_BUTTON_CLASS,
  chipClassName = DEFAULT_CHIP_CLASS,
  mutedClassName = DEFAULT_MUTED_CLASS,
  errorClassName = DEFAULT_ERROR_CLASS,
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
  const [convergence, setConvergence] = useState<
    { typed: AddTopicCandidate; suggestions: AddTopicCandidate[] } | null
  >(null);

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
      setConvergence(null);
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

  // The actual persistence step. Shared by every path; convergence (below)
  // resolves WHICH label to persist before calling this.
  const persistTopic = useCallback(
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
        setConvergence(null);
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

  // Add a specific topic. When convergeBeforeAdd is on, first align it onto an
  // existing canonical domain across the game: an exact match is applied
  // transparently; fuzzy matches surface a "did you mean?" choice; otherwise we
  // persist the typed label. Any converge failure falls through to a plain add.
  const commit = useCallback(
    async (candidate: AddTopicCandidate) => {
      if (!convergeBeforeAdd) {
        await persistTopic(candidate);
        return;
      }
      const label = candidate.label.trim();
      if (!label || busy) return;
      if (isDuplicate(label)) {
        setError('You already added that one.');
        return;
      }
      setBusy(true);
      setError(null);
      setLimitReached(false);
      setConvergence(null);
      setPendingLabel(label);
      let resolved: AddTopicCandidate | null = candidate;
      let prompt: { typed: AddTopicCandidate; suggestions: AddTopicCandidate[] } | null = null;
      try {
        const response = await fetch('/api/knowledge/converge', {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label }),
        });
        const body = await response.json().catch(() => null);
        if (response.ok) {
          const list: ConvergeApiCandidate[] = Array.isArray(body?.candidates)
            ? body.candidates
            : [];
          const exact = list.find(
            (item) => item?.kind === 'exact' && typeof item.label === 'string',
          );
          const fuzzy = list.filter(
            (item) => item?.kind === 'fuzzy' && typeof item.label === 'string',
          );
          if (exact) {
            // Same domain — converge silently onto the canonical spelling.
            resolved = {
              label: exact.label,
              broadCategory: exact.broadCategory ?? candidate.broadCategory ?? null,
            };
          } else if (fuzzy.length > 0) {
            // Never auto-apply a fuzzy match — let the user pick or keep theirs.
            resolved = null;
            const own =
              typeof body?.raw === 'string' && body.raw.trim() ? body.raw.trim() : label;
            prompt = {
              typed: { label: own, broadCategory: candidate.broadCategory ?? null },
              suggestions: fuzzy.map((item) => ({
                label: item.label,
                broadCategory: item.broadCategory ?? null,
              })),
            };
          }
        }
      } catch {
        // Converge is best-effort — fall through and add the typed label.
        resolved = candidate;
      } finally {
        setBusy(false);
        setPendingLabel(null);
      }

      if (prompt) {
        setConvergence(prompt);
        return;
      }
      if (resolved) await persistTopic(resolved);
    },
    [convergeBeforeAdd, persistTopic, busy, isDuplicate],
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
    <div className={className}>
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
            className={inputClassName}
          />
          <button
            type="submit"
            className={buttonClassName}
            disabled={disabled || busy || !value.trim()}
          >
            {busy ? 'Working…' : 'Add'}
          </button>
        </div>
      </form>

      {candidates ? (
        <div className="mt-4">
          <p className={mutedClassName}>
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
                className={chipClassName}
              >
                {pendingLabel === candidate.label.trim() ? 'Adding…' : candidate.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {convergence ? (
        <div className="mt-4">
          <p className={mutedClassName}>
            Did you mean one of these? Joining an area others already explore keeps your
            questions sharper.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {convergence.suggestions.map((suggestion) => (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => void persistTopic(suggestion)}
                disabled={busy}
                className={chipClassName}
              >
                {pendingLabel === suggestion.label.trim() ? 'Adding…' : suggestion.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void persistTopic(convergence.typed)}
              disabled={busy}
              className={chipClassName}
            >
              {pendingLabel === convergence.typed.label.trim()
                ? 'Adding…'
                : `Add “${convergence.typed.label}” instead`}
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className={errorClassName}>
          {error}
          {limitReached && limitReachedNode ? <> {limitReachedNode}</> : null}
        </p>
      ) : null}
    </div>
  );
}

export default AddTopicField;
