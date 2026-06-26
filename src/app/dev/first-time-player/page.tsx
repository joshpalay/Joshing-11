import Link from 'next/link';
import { ChevronLeft, Info } from 'lucide-react';

import { FirstSessionPanel } from '@/app/daily/summary/FirstSessionPanel';
import type {
  FirstSessionRecapBeat3,
  FirstSessionRecapView,
} from '@/server/daily/first-session-recap';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: preview the first-session recap a brand-new player sees after
 * their very first Daily Five.
 *
 * Drives the REAL `FirstSessionPanel` (not a duplicated replica) with a mock
 * recap, including `recap.beat3` — the social handoff the server computes. The
 * panel is mounted with `preview`, which suppresses its side effects, so a
 * replay never records the one-time "seen" signal or PATCHes reminder settings.
 *
 * Beat 3 has three branches depending on whether the player arrived via an
 * inviter (and whether that inviter has played yet); all three are shown here.
 */

function mockRecap(beat3: FirstSessionRecapBeat3): FirstSessionRecapView {
  return {
    type: 'first_session',
    firstName: 'Sam',
    beat2: {
      touchedDomains: ['World Geography', 'Modern Art'],
      offTheGroundDomain: 'World Geography',
      newTerritoryDomain: 'Modern Art',
    },
    beat3,
  };
}

const BEAT3_VARIANTS: { label: string; note?: string; beat3: FirstSessionRecapBeat3 }[] = [
  {
    label: 'Inviter already playing',
    beat3: { kind: 'inviter_present', inviterName: 'Maya' },
  },
  {
    label: "Inviter hasn't played yet",
    beat3: { kind: 'inviter_future', inviterName: 'Maya' },
  },
  {
    label: 'No inviter on record',
    note: 'draft copy',
    beat3: { kind: 'no_inviter' },
  },
];

export default function DevFirstTimePlayerPage() {
  return (
    <main className="min-h-dvh bg-[var(--brand-cream-page)] px-4 py-6 text-[var(--brand-ink)]">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/users/me"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Dev tools
        </Link>

        <h1 className="mt-6 font-serif text-3xl font-semibold leading-tight">First-session recap</h1>

        <div className="mt-4 flex gap-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-card)] p-4 text-card-foreground">
          <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div className="text-sm leading-6 text-muted-foreground">
            <p className="font-medium text-foreground">The real panel, driven read-only.</p>
            <p className="mt-1">
              This mounts the genuine <code>FirstSessionPanel</code> with a mock recap — including
              the Beat 3 social handoff. It&apos;s a preview: it doesn&apos;t record the
              &ldquo;seen&rdquo; signal and the reminder field doesn&apos;t change any account
              settings. Only one Beat 3 branch renders for a given player; all three are shown
              below.
            </p>
          </div>
        </div>

        <div className="mt-8 space-y-8">
          {BEAT3_VARIANTS.map((variant) => (
            <section key={variant.beat3.kind}>
              <p className="mb-2 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                Beat 3 · {variant.label}
                {variant.note ? <span className="text-amber-700"> · {variant.note}</span> : null}
              </p>
              <FirstSessionPanel recap={mockRecap(variant.beat3)} preview />
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
