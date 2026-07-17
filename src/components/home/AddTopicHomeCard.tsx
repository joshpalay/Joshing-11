'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

import { AddTopicField } from '@/components/interests/AddTopicField';

// Homepage "Add a topic" module (Josh, 2026-07-17): a lightweight entry point
// to seed a Daily Five topic without leaving Home. Mirrors the /daily/setup
// inline field, but input-only (no suggestion circles) so it adds no data cost
// to the perf-sensitive home hot path; "Manage topics →" links to the full
// surface. Card + eyebrow styling matches the other home feature modules.
export function AddTopicHomeCard() {
  const [added, setAdded] = useState<string | null>(null);

  // Auto-dismiss the confirmation so the card returns to its resting state.
  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(null), 4500);
    return () => window.clearTimeout(timer);
  }, [added]);

  return (
    <section className="card px-5 py-4" aria-label="Add a topic">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
          Add a topic
        </p>
        <Link
          href="/daily/setup"
          className="text-xs font-medium tracking-[0.08em] text-[var(--brand-link)] uppercase hover:opacity-70"
        >
          Manage topics →
        </Link>
      </div>
      <p
        className="mt-1 mb-3 text-sm leading-6 text-[var(--text-muted-warm)]"
        style={{ fontFamily: 'var(--font-serif), Georgia, serif' }}
      >
        Something you&rsquo;d love to be asked about? Add it and it&rsquo;ll seed your Daily Five.
      </p>
      <AddTopicField
        convergeBeforeAdd
        // Standard field radius (matches the /daily/setup Add a topic input),
        // not the pill default.
        inputClassName="min-h-12 flex-1 rounded-[var(--radius-xs)] border border-[var(--accent-gold)] bg-[var(--brand-field)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--text-muted-warm)]/60 focus:border-[var(--brand-navy)] focus-visible:outline-none disabled:opacity-60"
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
          if (!response.ok) {
            const body = (await response.json().catch(() => null)) as { message?: string } | null;
            throw new Error(body?.message ?? 'Could not add that topic.');
          }
          setAdded(topic.label);
        }}
      />
      {added ? (
        <p className="mt-2 text-sm text-[var(--brand-ink)]" role="status" aria-live="polite">
          Added &ldquo;{added}&rdquo; — it&rsquo;ll show up in an upcoming round.
        </p>
      ) : null}
    </section>
  );
}
