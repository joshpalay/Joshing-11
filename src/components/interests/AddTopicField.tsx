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

/**
 * Split a raw field value into distinct topic tokens. People read a "pick 3"
 * prompt and type "Byzantine Coinage, Jazz, Chess" into the one field expecting
 * three topics — so we treat commas and newlines as separators, trim, drop
 * blanks, and dedupe case-insensitively (first spelling wins). A single topic
 * with no separators comes back as a one-element list, so callers can branch on
 * length without special-casing.
 */
export function parseTopicTokens(raw: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const part of raw.split(/[,\n]+/)) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tokens.push(trimmed);
  }
  return tokens;
}

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
  'min-h-12 flex-1 rounded-full border border-[var(--accent-gold)] bg-[var(--brand-field)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--text-muted-warm)]/60 focus:border-[var(--brand-navy)] focus-visible:outline-none disabled:opacity-60';
const DEFAULT_BUTTON_CLASS = 'btn-ghost';
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
   * Discoverability hint shown under the field so people know the one input
   * accepts several comma-separated topics. Defaults to a standard line; pass
   * `false` to hide it on surfaces where the affordance is obvious.
   */
  multiAddHint?: ReactNode | false;
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
  multiAddHint = 'Add one at a time, or a few at once separated by commas.',
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
  // Remaining tokens from a comma/newline-separated submission, added one at a
  // time so each still gets the full expand / "did you mean?" treatment. The
  // ref drives the drain loop across awaits; the count mirrors it for the UI.
  const queueRef = useRef<string[]>([]);
  const [queueLen, setQueueLen] = useState(0);
  const setQueue = useCallback((items: string[]) => {
    queueRef.current = items;
    setQueueLen(items.length);
  }, []);

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
      // Expansion never persists — it either surfaced choices or an error, both
      // of which pause the queue driver.
      return false;
    },
    [isDuplicate],
  );

  // The actual persistence step. Shared by every path; convergence (below)
  // resolves WHICH label to persist before calling this.
  // Returns true only when the topic was added cleanly — the queue driver uses
  // that to decide whether to advance or pause (a too-broad backstop expands, a
  // failure surfaces an error; both stop the drain until the user acts).
  const persistTopic = useCallback(
    async (candidate: AddTopicCandidate): Promise<boolean> => {
      const label = candidate.label.trim();
      if (!label || busy) return false;
      if (isDuplicate(label)) {
        setError('You already added that one.');
        return false;
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
        return true;
      } catch (caught) {
        const coded = caught as AddTopicError;
        if (coded?.code === 'too_broad') {
          await expand(label);
          return false;
        }
        if (coded?.code === 'limit_reached') setLimitReached(true);
        setError(caught instanceof Error ? caught.message : 'Could not add that topic.');
        return false;
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
    async (candidate: AddTopicCandidate): Promise<boolean> => {
      if (!convergeBeforeAdd) {
        return persistTopic(candidate);
      }
      const label = candidate.label.trim();
      if (!label || busy) return false;
      if (isDuplicate(label)) {
        setError('You already added that one.');
        return false;
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
        return false;
      }
      if (resolved) return persistTopic(resolved);
      return false;
    },
    [convergeBeforeAdd, persistTopic, busy, isDuplicate],
  );

  // Route one typed label to the right path: broad buckets expand into specific
  // choices, everything else commits (converging first when enabled). Shared by
  // the single-add path and the multi-token queue below. Returns whether the
  // topic was added cleanly (false when it paused for input or errored).
  const processToken = useCallback(
    async (raw: string): Promise<boolean> => {
      const label = raw.trim();
      if (!label) return false;
      if (isDuplicate(label)) {
        setError('You already added that one.');
        return false;
      }
      if (isTooBroadInterest(label)) {
        return expand(label);
      }
      return commit({ label });
    },
    [isDuplicate, expand, commit],
  );

  // Drain the remaining comma/newline-separated tokens one at a time, moving on
  // only after each is added cleanly. A token that needs input (expands into
  // choices or a "did you mean?") or errors returns false and stops the drain;
  // the interactive handlers below resume it once the user resolves that step.
  const runQueue = useCallback(async () => {
    while (queueRef.current.length > 0) {
      const [next, ...rest] = queueRef.current;
      setQueue(rest);
      // Moving on discards any leftover choices from a prior token's expansion.
      setCandidates(null);
      setConvergence(null);
      const added = await processToken(next);
      if (!added) break;
    }
  }, [setQueue, processToken]);

  // Await an interactive resolution (a candidate pick or a "did you mean?"
  // choice), then keep draining any queued tokens behind it.
  const resolveThenDrain = useCallback(
    async (op: Promise<boolean>) => {
      const added = await op;
      if (added && queueRef.current.length > 0) void runQueue();
    },
    [runQueue],
  );

  const submit = useCallback(async () => {
    if (busy || disabled) return;
    const tokens = parseTopicTokens(value);
    if (tokens.length === 0) return;
    // One topic: keep the classic behavior — the value clears on a successful
    // add (persistTopic) and survives an error so it can be corrected.
    if (tokens.length === 1) {
      await processToken(tokens[0]);
      return;
    }
    // Several topics pasted at once. Drop any that already exist, then clear the
    // field and drain them one at a time.
    const fresh = tokens.filter((token) => !isDuplicate(token));
    if (fresh.length === 0) {
      setError('You already added those.');
      return;
    }
    setValue('');
    setError(null);
    setQueue(fresh);
    await runQueue();
  }, [busy, disabled, value, isDuplicate, processToken, setQueue, runQueue]);

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

      {multiAddHint && queueLen === 0 && !candidates && !convergence ? (
        <p className={`${mutedClassName} mt-2`}>{multiAddHint}</p>
      ) : null}

      {queueLen > 0 ? (
        <p className={`${mutedClassName} mt-2`}>
          {error ? (
            <>
              {`${queueLen} more from your list waiting. `}
              <button
                type="button"
                onClick={() => {
                  setError(null);
                  void runQueue();
                }}
                disabled={busy}
                className="font-medium underline underline-offset-2 disabled:opacity-50"
              >
                {`Skip and add the rest`}
              </button>
            </>
          ) : (
            `${queueLen} more from your list to add.`
          )}
        </p>
      ) : null}

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
                onClick={() => void resolveThenDrain(commit(candidate))}
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
                onClick={() => void resolveThenDrain(persistTopic(suggestion))}
                disabled={busy}
                className={chipClassName}
              >
                {pendingLabel === suggestion.label.trim() ? 'Adding…' : suggestion.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void resolveThenDrain(persistTopic(convergence.typed))}
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
