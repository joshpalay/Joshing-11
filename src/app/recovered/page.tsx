import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RecoveredDeck } from '@/components/recovered/RecoveredDeck';
import { getSession } from '@/server/auth/session';
import { getRecoveredQuestionsForUser } from '@/server/db/queries/recovered-questions';

/**
 * D-REVIEW-RECOVERED-01 — the Recovered-Questions review surface (Version A).
 *
 * A personal, profile-resident pool of the questions the viewer got wrong and
 * then later got right. Self-initiated from the profile — never pushed, no
 * "due" badge, no streak. The surface deals ONE question at a time from a
 * server-shuffled deck: reveal the answer, move to the next, or dismiss the
 * question out of circulation (reversible; the dismissed shelf lists them all
 * with Restore). The how-far-back filter is plain links over a `?range=`
 * search param — a reload deals a fresh shuffle. The deck interaction lives in
 * the RecoveredDeck client island; the pool itself stays read-only (see the
 * query module), with dismiss/restore as the surface's only write.
 */
export const dynamic = 'force-dynamic';

// How far back the deck reaches, keyed by the `?range=` search param. `null`
// days means unbounded (all time) — the default, and the fallback for any
// unrecognized param value. The dismissed shelf is always all-time.
const RANGES = [
  { key: 'week', label: 'Past week', days: 7 },
  { key: 'month', label: 'Past month', days: 30 },
  { key: '3months', label: 'Past 3 months', days: 90 },
  { key: 'year', label: 'Past year', days: 365 },
  { key: 'all', label: 'All time', days: null },
] as const;

function resolveRange(param: string | undefined) {
  return RANGES.find((r) => r.key === param) ?? RANGES[RANGES.length - 1]!;
}

export default async function RecoveredQuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const session = await getSession();
  if (!session) notFound();

  const params = await searchParams;
  const range = resolveRange(params.range);
  const { deck, dismissed } = await getRecoveredQuestionsForUser(session.userId, {
    withinDays: range.days,
  });

  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6 pb-20">
      <header>
        <p className="font-mono text-[0.62rem] uppercase tracking-[0.06em] text-muted-foreground">
          <Link href="/" className="underline underline-offset-2">HOME</Link>
          {' / '}
          <Link href="/users/me" className="underline underline-offset-2">PROFILE</Link>
          {' / REVISIT'}
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold leading-tight text-foreground">
          The ones you turned around
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Questions you once missed and later got right, dealt one at a time in a random order.
          Recall the answer, reveal it to check yourself, then move on to the next.
        </p>
      </header>

      <nav
        aria-label="How far back to revisit"
        className="mt-5 flex flex-wrap gap-x-4 gap-y-2 font-mono text-[0.62rem] uppercase tracking-[0.06em]"
      >
        {RANGES.map((option) =>
          option.key === range.key ? (
            <span key={option.key} aria-current="true" className="font-semibold text-foreground">
              {option.label}
            </span>
          ) : (
            <Link
              key={option.key}
              href={option.days === null ? '/recovered' : `/recovered?range=${option.key}`}
              className="text-muted-foreground underline underline-offset-2"
            >
              {option.label}
            </Link>
          ),
        )}
      </nav>

      <RecoveredDeck
        deck={deck}
        dismissed={dismissed}
        rangeLabel={range.days === null ? null : range.label.toLowerCase()}
      />
    </main>
  );
}
