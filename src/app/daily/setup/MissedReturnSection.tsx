'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Switch } from '@/components/ui/Switch';

/**
 * D-MISSED-RETURN-01 §7-D — the Customize surface for returning questions.
 *
 * ONE surface, not two (R11): the toggle at the top, the currently-eligible
 * questions below it, each with a dismiss.
 *
 * Deliberately lighter than the Recovered pattern. §7-C rules out a browsable
 * dismissed archive and a dimmed/archived section — a dismissed row simply
 * leaves the list, with a few seconds to undo. That is the whole reversal story.
 *
 * REGISTER (§1, §6): this is not remediation and must never read as it. No
 * "you got this wrong", no "practice", no "review", no counts of failure. A
 * returning question is something a friend taught you, coming back to see if it
 * stuck. The expired scope gets NO return framing at all — it has never been
 * seen, so it reads as a question that simply hasn't been asked yet.
 *
 * Copy here is the working pass; Phase 4 replaces it from the approved copy pass.
 */

const UNDO_WINDOW_MS = 6000;

export type MissedReturnItem = {
  /** Which table the id belongs to — the Daily Five serves both kinds. */
  kind: 'canonical' | 'generated';
  questionId: string;
  scope: 'wrong' | 'expired';
  questionText: string;
  category: string | null;
  authorName: string | null;
  /** ISO — when they last saw it (the wrong answer, or the day it expired). */
  lastSeenAt: string;
  returnCount: number;
};

function formatSeen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
}

export function MissedReturnSection({
  initialEnabled,
  initialItems,
}: {
  initialEnabled: boolean;
  initialItems: MissedReturnItem[];
}) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [items, setItems] = useState(initialItems);
  /** The row awaiting its undo window. Null when nothing is pending. */
  const [pending, setPending] = useState<MissedReturnItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const toggle = useCallback(async (next: boolean) => {
    setEnabled(next); // optimistic — the control should never feel laggy
    setError(null);
    try {
      const res = await fetch('/api/daily/missed-return/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: next }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      setEnabled(!next);
      setError('That didn’t save. Try again?');
    }
  }, []);

  /**
   * Dismiss writes IMMEDIATELY — the undo window is a grace period on a real
   * write, not a delayed one. If the player closes the tab mid-window the
   * dismiss still stands, which is the honest reading of "I don't want this
   * back" and avoids a row that silently reappears tomorrow.
   */
  const dismiss = useCallback(
    async (item: MissedReturnItem) => {
      clearTimer();
      setError(null);
      setItems((current) => current.filter((i) => i.questionId !== item.questionId));
      setPending(item);
      timerRef.current = window.setTimeout(() => setPending(null), UNDO_WINDOW_MS);

      try {
        const res = await fetch('/api/daily/missed-return/dismiss', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ questionId: item.questionId, kind: item.kind }),
        });
        if (!res.ok) throw new Error('failed');
      } catch {
        setItems((current) => [item, ...current]);
        setPending(null);
        clearTimer();
        setError('That didn’t save. Try again?');
      }
    },
    [clearTimer],
  );

  const undo = useCallback(async () => {
    if (!pending) return;
    const item = pending;
    clearTimer();
    setPending(null);
    setError(null);
    try {
      const res = await fetch('/api/daily/missed-return/dismiss', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionId: item.questionId, kind: item.kind }),
      });
      if (!res.ok) throw new Error('failed');
      setItems((current) =>
        current.some((i) => i.questionId === item.questionId) ? current : [item, ...current],
      );
    } catch {
      setError('Couldn’t undo that. Try again?');
    }
  }, [pending, clearTimer]);

  return (
    <section className="mx-auto mt-2 w-[min(672px,94vw)] px-1 pb-10">
      <div className="border-t border-[var(--border-warm)] pt-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h2 className="m-0 font-serif text-lg font-semibold text-[var(--brand-ink)]">
              Questions that come back
            </h2>
            <p className="mt-1 mb-0 text-quiet leading-[1.5] text-[var(--text-muted-warm)]">
              Every so often, one question you didn’t land turns up again in your five. Nothing
              stacks up — it’s one at a time, and once you get it, it’s done.
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={(next) => void toggle(next)}
            label="Let missed questions come back"
            className="mt-1"
          />
        </div>

        {error ? (
          <p className="mt-3 mb-0 text-quiet text-[var(--brand-ink)]" role="status" aria-live="polite">
            {error}
          </p>
        ) : null}

        {pending ? (
          <div
            className="mt-3 flex items-center justify-between gap-3 rounded-[var(--radius-xs)] border border-[var(--border-warm)] bg-[var(--cream-warm)] px-3 py-2"
            role="status"
            aria-live="polite"
          >
            <p className="m-0 text-quiet text-[var(--ink)]">Removed</p>
            <button
              type="button"
              className="text-xs font-semibold tracking-[0.08em] text-[var(--brand-link)] uppercase transition hover:opacity-70"
              onClick={() => void undo()}
            >
              Undo
            </button>
          </div>
        ) : null}

        {enabled ? (
          items.length > 0 ? (
            <ul className="mt-4 grid list-none gap-2 p-0">
              {items.map((item) => (
                <li
                  key={`${item.kind}:${item.questionId}`}
                  className="flex items-start justify-between gap-3 rounded-[var(--radius-xs)] border border-[var(--border-warm)] bg-[var(--brand-card)] px-3 py-2.5"
                >
                  <div className="flex-1">
                    <p className="m-0 text-sm leading-[1.45] text-[var(--brand-ink)]">
                      {item.questionText}
                    </p>
                    <p className="mt-1 mb-0 text-quiet text-[var(--text-muted-warm)]">
                      {/* Provenance, honestly (R9). The 'wrong' scope says when
                          they last saw it; 'expired' never implies they did. */}
                      {item.scope === 'wrong'
                        ? `${item.authorName ? `${item.authorName} · ` : ''}from ${formatSeen(item.lastSeenAt)}`
                        : `${item.authorName ? `${item.authorName} · ` : ''}never got to this one`}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="shrink-0 text-xs font-semibold tracking-[0.08em] text-[var(--text-muted-warm)] uppercase transition hover:text-[var(--brand-ink)]"
                    onClick={() => void dismiss(item)}
                    aria-label={`Don’t bring back: ${item.questionText}`}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-4 mb-0 text-quiet leading-[1.5] text-[var(--text-muted-warm)]">
              Nothing’s waiting to come back right now.
            </p>
          )
        ) : null}
      </div>
    </section>
  );
}
