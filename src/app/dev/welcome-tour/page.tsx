import Link from 'next/link';
import { ChevronLeft, SlidersHorizontal } from 'lucide-react';

import WelcomeTour from '@/components/welcome/WelcomeTour';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: replay the first-run welcome tour in isolation.
 *
 * The live tour overlays the real home (mounted by `?welcome=1`). This page
 * stands in a static, side-effect-free home replica carrying all five
 * `data-tour` anchors (five, customize, foryou, friends, shared) plus the
 * closing-panel slot, then mounts `<WelcomeTour forced />`. `forced` bypasses —
 * and never writes — the persisted seen-flag, so replaying here never mutates
 * real state, and every callout resolves to a target (the live home only
 * carries some anchors today; here all five are present).
 *
 * The closing CTA routes to `/daily` like the real tour. To re-run, reload.
 */

// Generous inter-section spacing so snap & dwell has real scroll distance to
// travel between callouts (the live home tunes this per-section).
const SECTION_GAP = { paddingBottom: '34vh' } as const;

export default function DevWelcomeTourPage() {
  return (
    <main className="min-h-dvh bg-[var(--brand-cream-page)] text-[var(--brand-ink)]">
      <div className="mx-auto max-w-2xl px-4 py-6">
        <Link
          href="/dev/onboarding"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="size-4" />
          Onboarding stages
        </Link>

        <div className="mt-6 flex flex-col gap-5" style={{ paddingTop: '4vh' }}>
          {/* Today's Five — carries both the `five` and `customize` anchors. */}
          <div style={SECTION_GAP}>
            <div
              data-tour="five"
              className="text-card-foreground w-full rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-[var(--feed-card-elevated)] px-4 py-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold tracking-[0.12em] text-[var(--brand-ink-700)] uppercase">
                  Today&apos;s Five
                </p>
                <span
                  data-tour="customize"
                  className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--brand-border)_60%,transparent)] bg-[var(--brand-cream-page)] px-3 py-2 text-[12px] font-bold text-[var(--brand-ink)]"
                >
                  <SlidersHorizontal className="size-4" strokeWidth={2.4} aria-hidden="true" />
                  Customize
                </span>
              </div>
              <h2 className="mt-1 mb-2 font-serif text-[32px] leading-[40px] font-medium text-[var(--brand-ink)]">
                Ready when you are!
              </h2>
              <div className="mt-3 flex items-center gap-2" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((dot) => (
                  <span
                    key={dot}
                    className="block size-[11px] rounded-full"
                    style={{
                      border: '1px solid color-mix(in srgb, var(--brand-ink) 35%, transparent)',
                    }}
                  />
                ))}
              </div>
              <span className="btn-primary mt-4 w-full">Play now</span>
            </div>
          </div>

          {/* For You */}
          <section data-tour="foryou" style={SECTION_GAP}>
            <p className="mb-2 pl-0.5 text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
              For you
            </p>
            <article className="rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-[var(--brand-card)] p-4">
              <p className="text-sm text-[var(--brand-ink-700)]">
                <span className="font-semibold text-[var(--brand-ink)]">Joshua P</span> sent you a
                question they wrote
              </p>
              <p className="mt-3 mb-4 font-serif text-[1.3rem] leading-snug font-medium text-[var(--brand-ink)]">
                &ldquo;In the surrey with the fringe on top, what was the dashboard made of?&rdquo;
              </p>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Dismiss</span>
                <span className="btn-primary">Answer</span>
              </div>
            </article>
          </section>

          {/* From Friends */}
          <section data-tour="friends" style={SECTION_GAP}>
            <p className="mb-2 pl-0.5 text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink)] uppercase">
              From Friends <span className="opacity-60">(Past 7 days)</span>
            </p>
            <p className="mb-3 text-xs tracking-[0.04em] text-muted-foreground uppercase">
              Play the questions your friends have aced.
            </p>
            {[
              'has been on a tear through Tennis Fundamentals, Early 20th Century American History and 3 others',
              "has been all over 1980's Toys and Early 20th Century American History",
            ].map((blurb) => (
              <div
                key={blurb}
                className="mb-2 rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-[var(--brand-card)] p-4"
              >
                <p className="font-serif text-[1.2rem] font-semibold text-[var(--brand-ink)]">
                  Joshua P
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[var(--brand-ink-700)]">{blurb}</p>
                <div className="mt-2 flex items-center justify-end gap-1">
                  <span className="text-[13px] font-semibold text-[var(--brand-ink-700)]">
                    Play
                  </span>
                </div>
              </div>
            ))}
          </section>

          {/* Shared Ground */}
          <section data-tour="shared" style={SECTION_GAP}>
            <div
              className="rounded-[var(--radius-xs)] p-5"
              style={{ background: 'color-mix(in srgb, var(--success) 14%, var(--brand-cream-page))' }}
            >
              <h3 className="font-serif text-[1.4rem] leading-tight font-semibold text-[var(--brand-ink)]">
                You and Joshua keep meeting in the same places.
              </h3>
              <p className="mt-3 text-xs text-[var(--brand-ink-700)]">
                American City Nicknames · Bikini Bottom Animated Series
              </p>
              <p className="mt-4 text-[11px] font-semibold tracking-[0.08em] text-[var(--brand-ink)] uppercase">
                Shared ground with 1 friend
              </p>
              <span className="mt-3 inline-block border-b border-[var(--brand-ink)] pb-0.5 text-xs font-semibold tracking-[0.05em] text-[var(--brand-ink)] uppercase">
                Explore your overlap →
              </span>
            </div>
          </section>
        </div>
      </div>

      {/* Closing panel mounts here. */}
      <div id="welcome-tour-closer-slot" />

      <WelcomeTour forced />
    </main>
  );
}
