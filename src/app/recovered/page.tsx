import Link from 'next/link';
import { notFound } from 'next/navigation';

import { RecoveredCard } from '@/components/recovered/RecoveredCard';
import { getSession } from '@/server/auth/session';
import { getRecoveredQuestionsForUser } from '@/server/db/queries/recovered-questions';

/**
 * D-REVIEW-RECOVERED-01 — the Recovered-Questions review surface (Version A).
 *
 * A personal, profile-resident, read-only pool of the questions the viewer got
 * wrong and then later got right. Self-initiated from the profile — never
 * pushed, no "due" badge, no streak, no denominator. The whole page is a server
 * component with no client JS: the reveal is a native <details> on each card,
 * the how-far-back filter is plain links over a `?range=` search param, and the
 * order is a fresh server-side shuffle per load — so this surface still mints
 * no writes (see RecoveredCard / the query module).
 */
export const dynamic = 'force-dynamic';

// How far back the pool reaches, keyed by the `?range=` search param. `null`
// days means unbounded (all time) — the default, and the fallback for any
// unrecognized param value.
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
  const recovered = await getRecoveredQuestionsForUser(session.userId, { withinDays: range.days });

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
          Questions you once missed and later got right, in a random order. Sit with one, recall the answer, then reveal it to check yourself.
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

      {recovered.length === 0 ? (
        // Cold-start register (Decision D): discovery-framed, not a failure /
        // "nothing here" note. Most players (and every new player) land here.
        // A bounded range that comes up empty says so instead, since the pool
        // may simply be older than the window.
        <section className="mt-10 flex min-h-48 items-center justify-center text-center text-sm text-muted-foreground">
          {range.days === null
            ? 'The ones you turned around will gather here as you play.'
            : `Nothing turned around in the ${range.label.toLowerCase()} — try a longer stretch.`}
        </section>
      ) : (
        <section className="mt-6 space-y-3">
          {recovered.map((question) => (
            <RecoveredCard key={question.id} question={question} />
          ))}
        </section>
      )}
    </main>
  );
}
