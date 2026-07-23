'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Combine, Plus, Share2 } from 'lucide-react';

import { AddAreaModal } from '@/components/knowledge/AddAreaModal';
import { SharePortraitModal } from '@/components/knowledge/SharePortraitModal';
import type { ShareDomain } from '@/components/knowledge/SharePortraitCard';

// P5 follow-up — the share/tidy chrome from the flat knowledge page, on the
// bubble map. Share opens the existing portrait modal (it captures on mount —
// same fallback path the flat page uses when its background capture isn't
// ready). Tidy calls the same /api/knowledge/tidy merge pass, then refreshes
// so the repacked map reflects any combined domains.
// D-KNOWLEDGE-MAP-USABILITY-01 C2: Add opens the add-a-knowledge-area flow —
// on a map screen, "add" must mean adding to the MAP, not composing a question.

export function BubblePageChrome({
  playerDisplayName,
  portraitStatement,
  domains,
  overflowCount,
  tierSignature,
  existingLabels = [],
}: {
  playerDisplayName: string;
  portraitStatement: string;
  domains: ShareDomain[];
  overflowCount: number;
  tierSignature: string;
  /** Every owned domain label — dedup for the add-an-area field. */
  existingLabels?: string[];
}) {
  const router = useRouter();
  const [shareOpen, setShareOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [tidying, setTidying] = useState(false);
  const [tidyNotice, setTidyNotice] = useState<string | null>(null);

  async function tidy() {
    if (tidying) return;
    setTidying(true);
    setTidyNotice(null);
    try {
      const response = await fetch('/api/knowledge/tidy', { method: 'POST', credentials: 'include' });
      const body = (await response.json().catch(() => null)) as
        | { mergesApplied?: number; message?: string }
        | null;
      if (!response.ok || typeof body?.mergesApplied !== 'number') {
        throw new Error(body?.message ?? 'Could not tidy your map.');
      }
      setTidyNotice(body.mergesApplied > 0 ? `${body.mergesApplied} domains combined` : 'Nothing to combine');
      if (body.mergesApplied > 0) router.refresh();
    } catch (caught) {
      setTidyNotice(caught instanceof Error ? caught.message : 'Could not tidy your map.');
    } finally {
      setTidying(false);
      window.setTimeout(() => setTidyNotice(null), 3600);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {tidyNotice ? (
        <span className="text-xs text-[var(--text-muted)]" aria-live="polite">
          {tidyNotice}
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => setAddOpen(true)}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 type-metadata uppercase tracking-eyebrow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)', background: 'var(--brand-card)' }}
      >
        <Plus className="size-3.5" aria-hidden />
        Add
      </button>
      <button
        type="button"
        onClick={() => void tidy()}
        disabled={tidying}
        className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 type-metadata uppercase tracking-eyebrow disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)', background: 'var(--brand-card)' }}
      >
        <Combine className="size-3.5" aria-hidden />
        {tidying ? 'Tidying…' : 'Tidy'}
      </button>
      {domains.length > 0 ? (
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="inline-flex min-h-9 items-center gap-1.5 rounded-full border px-3 type-metadata uppercase tracking-eyebrow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)', background: 'var(--brand-card)' }}
        >
          <Share2 className="size-3.5" aria-hidden />
          Share
        </button>
      ) : null}

      {addOpen ? (
        <AddAreaModal existingLabels={existingLabels} onClose={() => setAddOpen(false)} />
      ) : null}

      {shareOpen ? (
        <SharePortraitModal
          playerDisplayName={playerDisplayName}
          portraitStatement={portraitStatement}
          domains={domains}
          overflowCount={overflowCount}
          tierSignature={tierSignature}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </div>
  );
}
