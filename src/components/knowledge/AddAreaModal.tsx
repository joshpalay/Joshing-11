'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowUpRight } from 'lucide-react';

import { AddTopicField, type AddTopicError } from '@/components/interests/AddTopicField';

// D-KNOWLEDGE-MAP-USABILITY-01 C2 — "Add an area" from the bubble-map screen.
// The shared AddTopicField carries the whole specificity pipeline (broad
// buckets expand into specific choices; convergence dedups against the game's
// canonical domains with a "did you mean?"); this sheet adds the persistence
// wiring (POST /api/declared-interests, same as daily setup) and the
// acknowledged outcome: "X is on your map — quiz me now."

export function AddAreaModal({
  existingLabels,
  onClose,
}: {
  existingLabels: string[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [added, setAdded] = useState<string | null>(null);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const actionButton =
    'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  return (
    <div
      className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center px-0 pb-0 md:items-center md:px-4 md:pb-4"
      style={{ backgroundColor: 'var(--scrim)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-area-title"
    >
      <button className="absolute inset-0 cursor-default" type="button" aria-label="Close add area" onClick={onClose} />
      <section className="relative w-full rounded-t-2xl bg-background p-5 shadow-xl md:max-w-md md:rounded-2xl">
        <h2 id="add-area-title" className="font-serif text-2xl font-semibold">
          Add a knowledge area
        </h2>

        {added ? (
          <>
            <p className="mt-3 font-serif text-base" aria-live="polite">
              <strong>{added}</strong> is on your map.
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Questions will start appearing in your Daily Five, and it takes shape as you answer
              them — or dive in right now.
            </p>
            <div className="mt-4 flex gap-2">
              <Link
                href="/daily"
                className={actionButton}
                style={{ borderColor: 'var(--brand-navy)', background: 'var(--brand-navy)', color: 'var(--brand-card)' }}
              >
                Quiz me now <ArrowUpRight className="size-4" aria-hidden />
              </Link>
              <button
                type="button"
                onClick={onClose}
                className={actionButton}
                style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
              >
                Done
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Name something you know — a person, era, scene, or work. Questions will start
              appearing in your Daily Five.
            </p>
            <AddTopicField
              className="mt-4"
              placeholder="e.g. Anton Bruckner"
              convergeBeforeAdd
              existingLabels={existingLabels}
              limitReachedNode={
                <span>Swap one out from your Daily Five setup first.</span>
              }
              onAdd={async (topic) => {
                const response = await fetch('/api/declared-interests', {
                  method: 'POST',
                  credentials: 'include',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify({
                    label: topic.label,
                    ...(topic.broadCategory ? { broadCategory: topic.broadCategory } : {}),
                  }),
                });
                const body = (await response.json().catch(() => null)) as
                  | { error?: string; message?: string; domain?: string }
                  | null;
                if (!response.ok) {
                  const error = new Error(body?.message ?? 'Could not add that area.') as AddTopicError;
                  if (body?.error === 'interest_limit_reached') error.code = 'limit_reached';
                  else if (body?.error === 'too_broad') error.code = 'too_broad';
                  throw error;
                }
                setAdded(body?.domain ?? topic.label);
                router.refresh();
              }}
            />
            <div className="mt-5 flex justify-center">
              <button type="button" className="btn-ghost min-w-28" onClick={onClose}>
                Cancel
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
