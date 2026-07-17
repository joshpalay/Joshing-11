'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { AddTopicField } from '@/components/interests/AddTopicField';
import { GhostTerritoryCircle } from '@/components/knowledge/GhostTerritoryCircle';
import { domainKey } from '@/lib/knowledge/domain-key';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

// Homepage "Add a topic" module (Josh, 2026-07-17): a lightweight entry point
// to seed a Daily Five topic without leaving Home. Mirrors the /daily/setup add
// block — the create-your-own field plus related-but-specific suggestion
// circles — but the suggestions are fetched client-side after mount (like
// TodaysFiveCard's status fetch) so they never touch the home critical path.
// "Manage topics →" links to the full surface. Card + eyebrow styling matches
// the other home feature modules.
export function AddTopicHomeCard() {
  const [added, setAdded] = useState<string | null>(null);
  const [pool, setPool] = useState<NearbyTerritory[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [addedKeys, setAddedKeys] = useState<ReadonlySet<string>>(new Set());
  const [addingKey, setAddingKey] = useState<string | null>(null);

  // Auto-dismiss the confirmation so the card returns to its resting state.
  useEffect(() => {
    if (!added) return;
    const timer = window.setTimeout(() => setAdded(null), 4500);
    return () => window.clearTimeout(timer);
  }, [added]);

  // Fetch + shuffle the suggestion pool once, client-side (off the home hot
  // path). Shuffle here (client-only, post-mount) so there's no SSR mismatch.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/interests/suggestions', { credentials: 'include' });
        if (!response.ok) return;
        const body = (await response.json().catch(() => null)) as
          | { suggestions?: NearbyTerritory[] }
          | null;
        if (cancelled) return;
        const list = Array.isArray(body?.suggestions) ? body.suggestions : [];
        for (let i = list.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [list[i], list[j]] = [list[j], list[i]];
        }
        setPool(list);
      } catch {
        // Suggestions are a nicety — the create-your-own field still works.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = useMemo(
    () =>
      pool
        .filter((territory) => {
          const key = domainKey(territory.domain);
          return !dismissed.has(key) && !addedKeys.has(key);
        })
        .slice(0, 3),
    [pool, dismissed, addedKeys],
  );

  const postInterest = async (label: string, broadCategory?: string | null) => {
    const response = await fetch('/api/declared-interests', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ label, ...(broadCategory ? { broadCategory } : {}) }),
    });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { message?: string } | null;
      throw new Error(body?.message ?? 'Could not add that topic.');
    }
  };

  const addSuggestion = async (territory: NearbyTerritory) => {
    if (addingKey) return;
    setAddingKey(domainKey(territory.domain));
    try {
      await postInterest(territory.domain, territory.broadCategory);
      setAddedKeys((prev) => new Set(prev).add(domainKey(territory.domain)));
      setAdded(territory.domain);
    } catch {
      // Leave the circle in place so the player can retry.
    } finally {
      setAddingKey(null);
    }
  };

  return (
    <section className="card px-5 py-4" aria-label="Add a topic">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-quiet font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
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
        {visible.length > 0
          ? 'Pick a suggestion below, or add something you’d love to be asked about.'
          : 'Something you’d love to be asked about? Add it and it’ll seed your Daily Five.'}
      </p>
      <AddTopicField
        convergeBeforeAdd
        // Standard field radius (matches the /daily/setup Add a topic input),
        // not the pill default.
        inputClassName="min-h-12 flex-1 rounded-[var(--radius-xs)] border border-[var(--accent-gold)] bg-[var(--brand-field)] px-4 text-sm text-[var(--ink)] placeholder:text-[var(--text-muted-warm)]/60 focus:border-[var(--brand-navy)] focus-visible:outline-none disabled:opacity-60"
        onAdd={async (topic) => {
          await postInterest(topic.label, topic.broadCategory ?? null);
          setAdded(topic.label);
        }}
      />
      {visible.length > 0 ? (
        <div className="mt-4 grid grid-cols-3 gap-3">
          {visible.map((territory) => (
            <GhostTerritoryCircle
              key={territory.domain}
              territory={territory}
              disabled={addingKey !== null}
              onAdd={() => void addSuggestion(territory)}
              onDismiss={() => setDismissed((prev) => new Set(prev).add(domainKey(territory.domain)))}
            />
          ))}
        </div>
      ) : null}
      {added ? (
        <p className="mt-3 text-sm text-[var(--brand-ink)]" role="status" aria-live="polite">
          Added &ldquo;{added}&rdquo; — it&rsquo;ll show up in an upcoming round.
        </p>
      ) : null}
    </section>
  );
}
