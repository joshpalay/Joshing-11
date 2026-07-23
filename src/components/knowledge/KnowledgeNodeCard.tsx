'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Plus, X, ZoomIn } from 'lucide-react';

import type { KnowledgeParentProgress } from '@/server/knowledge/knowledge-tree';

// D-KNOWLEDGE-MAP-USABILITY-01 B1/C1/C3 — the selection action card. A tap on
// the bubble map SELECTS a node and raises this card; every mutation or
// navigation is an explicit, labeled action here. Adding a ghost is a two-step
// confirm ("Add Bruckner?" → "Added — quiz me now"), never a silent side
// effect of a navigation tap.

export type SelectedNodeInfo = {
  id: string;
  name: string;
  field: string | null;
  ghost: boolean;
  mastered: boolean;
  /** Real points when the player owns this node directly; null otherwise. */
  points: number | null;
  hasChildren: boolean;
  progress?: KnowledgeParentProgress;
  /** Direct-child ghosts — the "fill this out" roster (own variant only). */
  ghostChildren: Array<{ id: string; name: string }>;
};

type AddPhase =
  | { step: 'idle' }
  | { step: 'confirm'; id: string; name: string }
  | { step: 'adding'; id: string; name: string }
  | { step: 'added'; id: string; name: string }
  | { step: 'failed'; id: string; name: string };

function fieldColor(field: string | null): string {
  return field ? `var(--cat-${field}, var(--brand-ink-400))` : 'var(--brand-ink-400)';
}

function formatPts(value: number): string {
  return new Intl.NumberFormat().format(Math.round(value));
}

// The custom-round Configure flow retired with /daily/setup; "quiz me" now
// heads to today's round directly.
function quizHref(_name: string): string {
  return '/daily';
}

export function KnowledgeNodeCard({
  node,
  variant,
  onClose,
  onDiveIn,
  onAdd,
}: {
  node: SelectedNodeInfo;
  variant: 'own' | 'friend';
  onClose: () => void;
  onDiveIn: () => void;
  /** Adopt a domain (the ghost-add path). Resolves false on failure. */
  onAdd: (id: string, name: string) => Promise<boolean>;
}) {
  const [phase, setPhase] = useState<AddPhase>({ step: 'idle' });

  const startAdd = (id: string, name: string) => setPhase({ step: 'confirm', id, name });

  const confirmAdd = async (id: string, name: string) => {
    setPhase({ step: 'adding', id, name });
    const ok = await onAdd(id, name);
    setPhase({ step: ok ? 'added' : 'failed', id, name });
  };

  const actionButton =
    'inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';

  // ── Confirm / added / failed take over the card body (C1) ──────────────────
  if (phase.step !== 'idle') {
    const { name } = phase;
    return (
      <section
        aria-label={`${name} actions`}
        className="rounded-xl border p-4 shadow-lg"
        style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
      >
        {phase.step === 'confirm' ? (
          <>
            <p className="font-serif text-base text-[var(--brand-ink)]">
              Add <strong>{name}</strong> to your map?
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Questions will start appearing in your Daily Five.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void confirmAdd(phase.id, name)}
                className={actionButton}
                style={{ borderColor: 'var(--brand-navy)', background: 'var(--brand-navy)', color: 'var(--brand-card)' }}
              >
                <Plus className="size-4" aria-hidden /> Add it
              </button>
              <button
                type="button"
                onClick={() => setPhase({ step: 'idle' })}
                className={actionButton}
                style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
              >
                Not now
              </button>
            </div>
          </>
        ) : phase.step === 'adding' ? (
          <p className="font-serif text-base text-[var(--brand-ink)]" aria-live="polite">
            Adding {name}…
          </p>
        ) : phase.step === 'added' ? (
          <>
            <p className="font-serif text-base text-[var(--brand-ink)]" aria-live="polite">
              <strong>{name}</strong> is on your map.
            </p>
            <p className="mt-1 text-sm text-[var(--text-muted)]">
              Questions will start appearing in your Daily Five — or dive in right now.
            </p>
            <div className="mt-3 flex gap-2">
              <Link
                href={quizHref(name)}
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
            <p className="font-serif text-base text-[var(--brand-ink)]" aria-live="polite">
              Couldn’t add {name} just now.
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => void confirmAdd(phase.id, name)}
                className={actionButton}
                style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => setPhase({ step: 'idle' })}
                className={actionButton}
                style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
              >
                Back
              </button>
            </div>
          </>
        )}
      </section>
    );
  }

  // ── Default view: identity, progress framing, explicit actions ─────────────
  const owned = node.points !== null && node.points > 0;
  const showFillOut = variant === 'own' && node.ghostChildren.length > 0;

  return (
    <section
      aria-label={`${node.name} actions`}
      className="rounded-xl border p-4 shadow-lg"
      style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-serif text-base text-[var(--brand-ink)]">
            <span
              aria-hidden
              className="size-3.5 flex-none rounded-full"
              style={{ background: node.mastered ? 'var(--accent-gold)' : fieldColor(node.field) }}
            />
            <strong className="truncate">{node.name}</strong>
          </p>
          <p className="mt-1 text-sm text-[var(--text-muted)]">
            {node.ghost
              ? 'Not started yet — a nearby area you could add.'
              : node.progress
                ? // C3 gap framing: coverage · points toward the bar (§9-A math).
                  `${node.progress.rosterCovered} of ${node.progress.rosterSize} areas · ${formatPts(node.progress.points)} / ${formatPts(node.progress.threshold)} pts${node.mastered ? ' · Mastery' : ''}`
                : owned
                  ? `${formatPts(node.points ?? 0)} pts${node.mastered ? ' · Mastery' : ''}`
                  : ''}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="grid size-8 flex-none place-items-center rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {node.ghost && variant === 'own' ? (
          <button
            type="button"
            onClick={() => startAdd(node.id, node.name)}
            className={actionButton}
            style={{ borderColor: 'var(--brand-navy)', background: 'var(--brand-navy)', color: 'var(--brand-card)' }}
          >
            <Plus className="size-4" aria-hidden /> Add to my map
          </button>
        ) : null}
        {node.hasChildren ? (
          <button
            type="button"
            onClick={onDiveIn}
            className={actionButton}
            style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
          >
            <ZoomIn className="size-4" aria-hidden /> Dive in
          </button>
        ) : null}
        {owned && !node.ghost && variant === 'own' ? (
          <>
            <Link
              href={`/knowledge/${encodeURIComponent(node.name)}`}
              className={actionButton}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              View details
            </Link>
            <Link
              href={quizHref(node.name)}
              className={actionButton}
              style={{ borderColor: 'var(--border)', color: 'var(--brand-ink-700)' }}
            >
              Quiz me here
            </Link>
          </>
        ) : null}
      </div>

      {showFillOut ? (
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs uppercase tracking-eyebrow text-[var(--text-muted)]">
            Fill this out
          </p>
          <ul className="mt-2 grid gap-1.5">
            {node.ghostChildren.map((ghost) => (
              <li key={ghost.id} className="flex items-center justify-between gap-2">
                <span className="truncate font-serif text-sm text-[var(--brand-ink)]">{ghost.name}</span>
                <button
                  type="button"
                  onClick={() => startAdd(ghost.id, ghost.name)}
                  className="inline-flex min-h-8 flex-none items-center gap-1 rounded-full border px-3 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  style={{ borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' }}
                >
                  <Plus className="size-3.5" aria-hidden /> Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
