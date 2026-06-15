import Link from 'next/link';
import { ChevronLeft, Info } from 'lucide-react';

/**
 * Dev tool: preview the first-time player experience.
 *
 * Linked from the Developer tools section of the profile page. It shows a
 * static, side-effect-free replica of the first-session recap panel a brand-new
 * player sees after completing their very first Daily Five (see
 * `FirstSessionPanel` / `first-session-recap.ts`). The real panel fires a
 * "seen" signal on mount and the reminder card mutates account settings, so we
 * deliberately do NOT mount the live components here — this is a look-only
 * preview, with an explanatory note pinned to the top.
 */
export default function DevFirstTimePlayerPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/users/me"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>

      <h1 className="mt-6 font-serif text-3xl font-semibold leading-tight">
        First time player
      </h1>

      {/* Information at top: what this preview is and how it differs from the
          live experience. */}
      <div className="mt-4 flex gap-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-card)] p-4 text-card-foreground">
        <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">
            What a brand-new player sees.
          </p>
          <p className="mt-1">
            This is the first-session recap that shows once, right after a player
            finishes their very first Daily Five. It&apos;s a look-only preview:
            unlike the live panel it doesn&apos;t record the &ldquo;seen&rdquo;
            signal or change any reminder settings.
          </p>
        </div>
      </div>

      {/* Static replica of FirstSessionPanel's first-session card. Sample name
          stands in for the real player's first name. */}
      <section className="mt-6 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-5">
        <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          First five complete
        </p>
        <h2 className="mt-2 font-serif text-2xl leading-tight text-[var(--brand-ink)]">
          Nice start, Sam.
        </h2>
        <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
          Five new questions come every day. Want different ones?{' '}
          <span className="text-[var(--brand-link)] underline underline-offset-4">
            Set your topics here
          </span>
          .
        </p>
      </section>

      {/* The live flow follows this with the reminder opt-in card. It mutates
          account settings, so we describe it rather than render it. */}
      <div className="mt-4 rounded-lg border border-dashed border-[var(--brand-border)] px-5 py-4 text-sm text-muted-foreground">
        In the live flow, the reminder opt-in card (&ldquo;Want a reminder when
        new questions land?&rdquo;) appears here.
      </div>
    </main>
  );
}
