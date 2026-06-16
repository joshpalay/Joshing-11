import Link from 'next/link';
import { type CSSProperties } from 'react';
import { ChevronLeft, Heart, Info, MoreHorizontal, Share2 } from 'lucide-react';

/**
 * Dev tool: preview the first-time player experience.
 *
 * Linked from the Developer tools section of the profile page. It shows a
 * static, side-effect-free replica of the first-session recap a brand-new
 * player sees after completing their very first Daily Five (see
 * `FirstSessionPanel` / `RoundReminderCard` / `first-session-recap.ts`).
 *
 * The live recap is NOT its own page — it renders inline at the top of the
 * Daily Summary (`src/app/daily/summary/page.tsx`). So this preview reproduces
 * that summary around made-up completed-game content: the summary header and
 * score, the first-session panel inline beneath it, the growth recap, a couple
 * of question cards, and the closing card. That way the panel is shown in the
 * context it actually appears in.
 *
 * The real component has side effects — `FirstSessionPanel` fires a "seen"
 * signal on mount and the reminder field PATCHes account settings — so we
 * deliberately do NOT mount the live component here. This page mirrors its
 * markup and copy but renders inert: a look-only preview filled out as if a
 * player had just finished their first five. The first-session card is a single
 * box (congrats + cadence + email-only reminder ask, no dismiss), matching the
 * live `FirstSessionPanel`.
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

// Mirrors the summary page's section-title style.
const sectionTitleStyle: CSSProperties = {
  fontFamily: 'var(--font-neutral), system-ui, sans-serif',
  fontSize: '0.8rem',
  fontWeight: 700,
  color: 'var(--brand-ink)',
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
};

// Made-up completed game: five questions, four correct. Mirrors the
// QuestionRecap shape the live summary renders, trimmed to what the static
// cards below need.
const MOCK_QUESTIONS = [
  { isCorrect: true, isSkipped: false },
  { isCorrect: true, isSkipped: false },
  { isCorrect: false, isSkipped: false },
  { isCorrect: true, isSkipped: false },
  { isCorrect: true, isSkipped: false },
];

const MOCK_CARDS = [
  {
    status: 'Correct' as const,
    domain: 'World Geography',
    author: 'The House',
    question: 'Which river flows through the most countries in the world?',
    youSaid: 'The Danube',
    answer: 'The Danube',
    explanation:
      'The Danube passes through ten countries — more than any other river — from its source in Germany to the Black Sea.',
  },
  {
    status: 'Not this time' as const,
    domain: 'Modern Art',
    author: 'The House',
    question: 'Who painted the 1907 work "Les Demoiselles d’Avignon"?',
    youSaid: 'Henri Matisse',
    answer: 'Pablo Picasso',
    explanation:
      'Picasso’s "Les Demoiselles d’Avignon" is widely seen as a proto-Cubist breakthrough that broke with traditional perspective.',
  },
];

function ResultDots() {
  return (
    <div className="flex items-center gap-2" aria-label="Question results">
      {MOCK_QUESTIONS.map((question, index) => (
        <span
          key={index}
          className="size-2.5 rounded-full border"
          style={{
            backgroundColor: question.isSkipped
              ? 'color-mix(in srgb, var(--brand-ink) 24%, transparent)'
              : question.isCorrect
                ? 'color-mix(in srgb, var(--game-correct) 88%, var(--brand-card))'
                : 'color-mix(in srgb, var(--game-wrong) 78%, var(--brand-card))',
            borderColor: 'color-mix(in srgb, var(--brand-border) 72%, transparent)',
            boxShadow: '0 0 0 2px var(--brand-card)',
          }}
        />
      ))}
    </div>
  );
}

function QuestionCard({ card }: { card: (typeof MOCK_CARDS)[number] }) {
  const isCorrect = card.status === 'Correct';
  return (
    <article className="relative overflow-hidden rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] p-5 shadow-none">
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{
          backgroundColor: isCorrect
            ? 'var(--game-correct)'
            : 'color-mix(in srgb, var(--game-wrong) 76%, var(--brand-card))',
        }}
      />

      <div className="flex items-start justify-between gap-3 pl-1">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-full border px-2.5 py-1 text-[0.68rem] font-semibold tracking-[0.05em]"
              style={{
                borderColor: isCorrect
                  ? 'color-mix(in srgb, var(--game-correct) 28%, var(--brand-border))'
                  : 'var(--brand-border)',
                backgroundColor: isCorrect
                  ? 'color-mix(in srgb, var(--game-correct) 8%, var(--brand-card))'
                  : 'color-mix(in srgb, var(--brand-cream-page) 62%, var(--brand-card))',
                color: isCorrect ? 'var(--game-correct)' : 'var(--brand-ink-700)',
              }}
            >
              {card.status}
            </span>
            <p className="text-xs leading-5 text-muted-foreground">
              <span>{card.domain}</span>
              <span aria-hidden="true"> · </span>
              <span>by {card.author}</span>
            </p>
          </div>
        </div>

        <span className="text-muted-foreground -mr-2 -mt-2 inline-flex size-10 shrink-0 items-center justify-center rounded-full">
          <MoreHorizontal className="size-5" />
        </span>
      </div>

      <p className="mt-4 pl-1 text-[1.12rem] leading-7 font-medium tracking-[-0.01em] text-[var(--brand-ink)]">
        {card.question}
      </p>

      <div className="mt-5 grid gap-3 rounded-md border border-[var(--brand-border)] bg-[var(--brand-cream-page)] p-3 sm:grid-cols-2">
        <div>
          <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            You said
          </p>
          <p className="mt-1 text-sm leading-6 text-[var(--brand-ink)]">{card.youSaid}</p>
        </div>
        <div className="border-t border-[var(--brand-border)] pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-3">
          <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Answer
          </p>
          <p
            className="mt-1 text-sm leading-6 font-medium"
            style={{ color: isCorrect ? 'var(--game-correct)' : 'var(--brand-ink)' }}
          >
            {card.answer}
          </p>
        </div>
      </div>

      <section className="mt-5 pl-1">
        <h3 className="text-sm font-semibold text-[var(--brand-ink)]">
          Why this is the answer
        </h3>
        <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
          {card.explanation}
        </p>
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-1 border-t border-[var(--brand-border)] pt-3 text-muted-foreground">
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs">
          <Heart className="size-4" />
          React
        </span>
        <span className="inline-flex min-h-9 items-center gap-1.5 rounded-full px-2.5 text-xs">
          <Share2 className="size-4" />
          Share
        </span>
      </div>
    </article>
  );
}

export default function DevFirstTimePlayerPage() {
  const totalCorrect = MOCK_QUESTIONS.filter((q) => q.isCorrect).length;

  return (
    <main className="min-h-dvh bg-[var(--brand-cream-page)] px-4 py-6 text-[var(--brand-ink)]">
      <div className="mx-auto max-w-3xl">
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
              This is the full first-session recap, shown the way it appears in
              the app: inline at the top of the Daily Summary, on top of a
              completed game. The made-up game below is a stand-in for the
              player&apos;s very first Daily Five. It&apos;s a look-only preview:
              unlike the live panel it doesn&apos;t record the &ldquo;seen&rdquo;
              signal, and the reminder field doesn&apos;t change any account
              settings.
            </p>
          </div>
        </div>

        {/* Static replica of the Daily Summary header (mirrors
            src/app/daily/summary/page.tsx) around made-up completed-game content. */}
        <div className="mt-8 rounded-2xl border border-dashed border-[var(--brand-border)] p-4">
          <p className="mb-4 text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
            Daily Summary · preview
          </p>

          <header className="pb-2">
            <span className="text-muted-foreground inline-flex min-h-9 items-center text-sm font-medium">
              Session recap
            </span>
            <div className="mt-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="font-serif text-[2.75rem] leading-[0.95] tracking-[-0.03em] text-[var(--brand-ink)] sm:text-5xl">
                  Today&rsquo;s Five
                </h2>
                <p className="mt-4 max-w-xl text-[1.02rem] leading-7 text-[var(--brand-ink-700)]">
                  You found common ground in World Geography and opened a few new
                  edges of the map.
                </p>
              </div>
              <p className="shrink-0 pt-2 text-sm font-medium text-[var(--brand-ink-400)]">
                {totalCorrect} / {MOCK_QUESTIONS.length}
              </p>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <ResultDots />
              <span className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--brand-border)] bg-[var(--brand-card)] px-3 text-sm font-medium text-[var(--brand-ink-700)]">
                <Share2 className="size-4" />
                Share your results
              </span>
            </div>
            <p className="text-muted-foreground mt-4 text-sm leading-6 italic">
              You found new ground in World Geography.
            </p>
          </header>

          {/* Inline first-session panel — the actual first-time-player surface.
              Static replica of FirstSessionPanel: a SINGLE card with the congrats
              + cadence note and the email-only reminder ask merged in (no
              dismiss). Sample name stands in for the real player's first name.
              Inert: the live field PATCHes /api/account/reminders, so here it
              renders but does nothing. */}
          <section className="mt-6 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-5">
            <p className="text-[0.68rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              First five complete
            </p>
            <h2 className="mt-2 font-serif text-2xl leading-tight text-[var(--brand-ink)]">
              Nice start, Sam.
            </h2>
            <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
              New questions come every day at noon — next up Wednesday at noon.
              Want different ones?{' '}
              <span className="text-[var(--brand-link)] underline underline-offset-4">
                Set your topics here
              </span>
              .
            </p>

            <div className="mt-5 border-t border-[var(--brand-border)] pt-5">
              <h3 style={reminderTitleStyle}>Want a daily reminder?</h3>
              <p className="text-foreground mt-2 text-sm leading-6">
                We can email you when new questions land. One message a day, max.
              </p>
              <form className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
                <input
                  type="email"
                  inputMode="email"
                  placeholder="you@example.com"
                  readOnly
                  className="bg-[var(--brand-field)] flex-1 rounded-lg border border-[var(--accent-gold)] px-3 py-2 text-sm focus:border-[var(--brand-navy)]"
                />
                <button type="button" className="btn-primary">
                  Email me
                </button>
              </form>
              <p className="text-muted-foreground mt-3 text-xs leading-5">
                We&apos;ll send a confirmation email once email reminders launch.
              </p>
            </div>
          </section>

          {/* Growth recap stub — present so the panel reads in its real context. */}
          <section className="mt-8 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-4">
            <h2 style={sectionTitleStyle}>Your Growth Recap</h2>
            <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
              World Geography and Modern Art both moved up a notch today.
            </p>
          </section>

          {/* Today's questions — made-up completed-game cards. */}
          <section className="mt-8">
            <div className="mb-4">
              <h2 className="font-serif text-2xl leading-tight text-[var(--brand-ink)]">
                Today&rsquo;s questions
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                A few were yours. A few were new.
              </p>
            </div>
            <div className="space-y-4">
              {MOCK_CARDS.map((card, index) => (
                <QuestionCard key={index} card={card} />
              ))}
            </div>
          </section>

          {/* Closing card. */}
          <section className="mt-8 rounded-lg border border-[var(--brand-border)] bg-[var(--brand-card)] px-5 py-6 text-center">
            <p className="text-[1.05rem] leading-7 text-[var(--brand-ink-700)]">
              Wednesday&rsquo;s five arrive at noon.
            </p>
            <div className="mt-5 flex flex-col items-center gap-3">
              <span className="btn-primary w-full sm:w-auto sm:min-w-56">
                Back home
              </span>
              <span className="text-muted-foreground text-sm font-medium underline underline-offset-4">
                See your knowledge map
              </span>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
