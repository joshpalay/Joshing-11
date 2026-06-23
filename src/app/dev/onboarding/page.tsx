import Link from 'next/link';
import { ChevronLeft, Compass, Info, Loader2, PlayCircle, Sparkles, UserPlus } from 'lucide-react';

import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow';

import { ResetWelcomeTourButton } from './ResetWelcomeTourButton';

export const dynamic = 'force-dynamic';

/**
 * Dev harness hub: replay every signup / first-run stage on demand.
 *
 * Each entry launches a stage in isolation against sample/dev data and is
 * read-only against real account state — it drives the genuine stage components
 * (or their faithful previews) without mutating onboarding completion or
 * seen-flags. Use it to inspect any stage repeatedly without burning the
 * one-time flags.
 *
 * Stages map to the live flow:
 *   setup (name/callsign) → areas of knowledge → [building your first five] →
 *   welcome tour → play → first-session recap.
 */
export default function DevOnboardingHubPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/users/me"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>

      <h1 className="mt-6 font-serif text-3xl font-semibold leading-tight">Onboarding stages</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Walk through every signup / first-run stage on demand.
      </p>

      <div className="mt-4 flex gap-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-card)] p-4 text-card-foreground">
        <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">Read-only replays.</p>
          <p className="mt-1">
            Each stage launches with sample data and won&apos;t mutate your real account&apos;s
            onboarding completion or seen-state. It&apos;s a preview, not a reset.
          </p>
        </div>
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-serif text-2xl font-semibold">Full experience</h2>
        <SettingsGroup>
          <SettingsRow
            icon={<PlayCircle className="size-5" />}
            title="Full signup walkthrough"
            subtitle="Setup → areas of knowledge → welcome tour → building → first-session recap, chained"
            href="/dev/onboarding/intro?walk=1"
          />
        </SettingsGroup>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-serif text-2xl font-semibold">Individual stages</h2>
        <SettingsGroup>
          <SettingsRow
            icon={<UserPlus className="size-5" />}
            title="Setup & areas of knowledge"
            subtitle="Name + call sign on one screen, then areas — the real flow, writes stubbed"
            href="/dev/onboarding/intro"
          />
          <SettingsRow
            icon={<Loader2 className="size-5" />}
            title="Building your first five"
            subtitle="The generation / loading wait state shown before the first round"
            href="/dev/loading-preview"
          />
          <SettingsRow
            icon={<Compass className="size-5" />}
            title="Welcome tour"
            subtitle="The first-run coach-marks over a sample home, into Play"
            href="/dev/welcome-tour"
          />
          <SettingsRow
            icon={<Sparkles className="size-5" />}
            title="First-session recap"
            subtitle="The post-first-five recap + Beat 3 social handoff a new player sees"
            href="/dev/first-time-player"
          />
        </SettingsGroup>
      </section>

      <section className="mt-8">
        <h2 className="mb-3 font-serif text-2xl font-semibold">Reset</h2>
        <p className="text-muted-foreground mb-3 text-sm">
          Clearly separated from the read-only replays above — this changes local first-run state.
        </p>
        <ResetWelcomeTourButton />
      </section>
    </main>
  );
}
