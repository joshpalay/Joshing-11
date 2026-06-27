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
 * so this surface mints no writes (see RecoveredCard / the query module).
 */
export const dynamic = 'force-dynamic';

export default async function RecoveredQuestionsPage() {
  const session = await getSession();
  if (!session) notFound();

  const recovered = await getRecoveredQuestionsForUser(session.userId);

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
          Questions you once missed and later got right. Sit with one, recall the answer, then reveal it.
        </p>
      </header>

      {recovered.length === 0 ? (
        // Cold-start register (Decision D): discovery-framed, not a failure /
        // "nothing here" note. Most players (and every new player) land here.
        <section className="mt-10 flex min-h-48 items-center justify-center text-center text-sm text-muted-foreground">
          The ones you turned around will gather here as you play.
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
