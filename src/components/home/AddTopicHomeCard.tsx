'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Check, Plus } from 'lucide-react';

import { TopicSuggestionCarousel } from '@/components/knowledge/TopicSuggestionCarousel';
import { domainKey } from '@/lib/knowledge/domain-key';
import type { NearbyTerritory } from '@/lib/daily/territory-model';

// The final carousel page, in place of a separate "+ Add your own" link
// below the card: a tile matching GhostTerritoryCircle's footprint (same
// size-16 circle, dashed border, quiet caption) but neutral-toned and a real
// link, since it navigates to the full manage surface rather than adding.
function AddYourOwnTile() {
  return (
    <Link
      href="/daily/setup"
      aria-label="Add your own topic"
      className="flex w-full flex-col items-center gap-2 rounded-[var(--radius-3xl)] p-1 text-center opacity-70 transition hover:opacity-100"
    >
      <div
        className="grid size-16 place-items-center rounded-full border border-dashed border-[var(--border-warm)] text-[var(--ink)]"
        style={{ background: 'color-mix(in srgb, var(--brand-card) 55%, transparent)' }}
      >
        <Plus className="size-5" aria-hidden="true" />
      </div>
      <span className="max-w-full px-1 font-serif text-quiet leading-tight text-[var(--ink)]">
        Add your own
      </span>
    </Link>
  );
}

// Homepage "Add a topic" module (Josh, 2026-07-17): suggestion circles only —
// a lightweight, low-clutter way to add a topic to your interests from Home
// by tapping a related-but-specific suggestion, paged through
// TopicSuggestionCarousel (swipe for more — no per-circle dismiss). The
// carousel's last page is always the "Add your own" tile above, linking to
// the full manage surface (/daily/setup) where the create-your-own text
// field lives — kept off Home to stay uncluttered, and off this card's
// footer since it's now reachable by swiping to the end. Suggestions are
// fetched client-side after mount (like TodaysFiveCard's status fetch) so
// they never touch the home critical path; the card hides itself until
// there's something to show.
export function AddTopicHomeCard() {
  // `created` comes from the POST response: an idempotent re-add of an
  // already-active topic returns created:false, and Undo must not render
  // there — it would deactivate the pre-existing interest.
  const [added, setAdded] = useState<{ domain: string; created: boolean } | null>(null);
  const [addedKeys, setAddedKeys] = useState<ReadonlySet<string>>(new Set());
  const [undoing, setUndoing] = useState(false);
  const [pool, setPool] = useState<NearbyTerritory[]>([]);
  const [loaded, setLoaded] = useState(false);

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
        // Suggestions are a nicety; failing quietly just hides the module.
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const addSuggestion = async (territory: NearbyTerritory): Promise<boolean> => {
    try {
      const response = await fetch('/api/declared-interests', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          label: territory.domain,
          ...(territory.broadCategory ? { broadCategory: territory.broadCategory } : {}),
        }),
      });
      if (!response.ok) throw new Error('add failed');
      const body = (await response.json().catch(() => null)) as
        | { domain?: string; created?: boolean }
        | null;
      // Prefer the canonical domain the server persisted over our local label.
      const domain = typeof body?.domain === 'string' && body.domain ? body.domain : territory.domain;
      setAdded({ domain, created: body?.created === true });
      setAddedKeys((prev) => new Set(prev).add(domainKey(domain)));
      return true;
    } catch {
      // Leave the circle in place so the player can retry.
      return false;
    }
  };

  // Undo the most recent add — deactivates that one domain (not a full
  // replace), so it can't clobber an interest declared elsewhere meanwhile.
  const undoAdded = async () => {
    if (!added?.created || undoing) return;
    setUndoing(true);
    try {
      const response = await fetch('/api/declared-interests', {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ domain: added.domain }),
      });
      if (!response.ok) throw new Error('undo failed');
      setAddedKeys((prev) => {
        const next = new Set(prev);
        next.delete(domainKey(added.domain));
        return next;
      });
      setAdded(null);
    } catch {
      // Leave the confirmation up — the circle is still genuinely added.
    } finally {
      setUndoing(false);
    }
  };

  // Nothing to show until suggestions arrive — keeps Home from carrying an
  // empty card while the fetch is in flight.
  if (!loaded || (pool.length === 0 && !added)) return null;

  return (
    <section className="card px-5 py-4" aria-label="Suggested topics">
      <p className="text-quiet font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
        Add a topic
      </p>
      <p
        className="mt-1 mb-3 text-sm leading-6 text-[var(--text-muted-warm)]"
        style={{ fontFamily: 'var(--font-serif), Georgia, serif' }}
      >
        A few you might like, based on your interests — swipe for more, or tap one to add it to
        your topics.
      </p>
      {pool.length > 0 ? (
        <TopicSuggestionCarousel
          suggestions={pool}
          addedKeys={addedKeys}
          onAdd={addSuggestion}
          trailingSlide={<AddYourOwnTile />}
        />
      ) : null}
      {added ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-[var(--radius-xs)] border border-[var(--border-warm)] bg-[var(--cream-warm)] px-3 py-2"
          role="status"
          aria-live="polite"
        >
          <Check className="mt-0.5 size-4 shrink-0 text-[var(--accent-gold-ink)]" aria-hidden="true" />
          <div className="flex-1">
            <p className="m-0 text-quiet text-[var(--ink)]">
              {added.created ? (
                <>Added &ldquo;{added.domain}&rdquo; — it may show up in an upcoming round.</>
              ) : (
                <>&ldquo;{added.domain}&rdquo; is already in your topics.</>
              )}
            </p>
            {added.created ? (
              <button
                type="button"
                className="mt-1 text-xs font-semibold tracking-[0.08em] text-[var(--brand-link)] uppercase transition hover:opacity-70 disabled:opacity-50"
                onClick={() => void undoAdded()}
                disabled={undoing}
              >
                {undoing ? 'Undoing…' : 'Undo'}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
