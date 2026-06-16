import Link from 'next/link';
import { type CSSProperties } from 'react';
import { ChevronLeft, Info } from 'lucide-react';

/**
 * Dev tool: preview the first-time player experience.
 *
 * Linked from the Developer tools section of the profile page. It shows a
 * static, side-effect-free replica of the first-session recap a brand-new
 * player sees after completing their very first Daily Five (see
 * `FirstSessionPanel` / `RoundReminderCard` / `first-session-recap.ts`).
 *
 * The full first-session panel is two stacked cards: the "first five complete"
 * note, then the reminder opt-in (reused from the returning-user prompt with a
 * first-timer title/description). The real components have side effects — the
 * panel fires a "seen" signal on mount and the reminder buttons PATCH account
 * settings — so we deliberately do NOT mount the live components here. This page
 * mirrors their markup and copy exactly but renders inert: a look-only preview
 * filled out as if a player had just finished everything.
 */

// Mirrors RoundReminderCard's `titleStyle` so the reminder card reads identically
// to the live opt-in. Kept inline (rather than imported) to keep this preview
// fully decoupled from the side-effectful component.
const reminderTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '1.05rem',
  fontWeight: 600,
  color: '#111111',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

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
            This is the full first-session recap that shows once, right after a
            player finishes their very first Daily Five — the &ldquo;first five
            complete&rdquo; note followed by the reminder opt-in. It&apos;s a
            look-only preview: unlike the live panel it doesn&apos;t record the
            &ldquo;seen&rdquo; signal, and the reminder buttons don&apos;t change
            any account settings.
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

      {/* Static replica of RoundReminderCard's idle state, with the first-timer
          title/description FirstSessionPanel passes in. Inert: the live buttons
          PATCH /api/account/reminders, so here they render but do nothing. */}
      <section className="card mt-5 px-5 py-4">
        <h2 style={reminderTitleStyle}>
          Want a reminder when new questions land?
        </h2>
        <p className="text-foreground mt-2 text-sm leading-6">
          One message a day, max. You can turn it off any time.
        </p>
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn-primary sm:flex-1">
            Yes, text me
          </button>
          <button type="button" className="btn-ghost sm:flex-1">
            Use email instead
          </button>
          <button type="button" className="btn-ghost sm:flex-1">
            No thanks
          </button>
        </div>
      </section>
    </main>
  );
}
