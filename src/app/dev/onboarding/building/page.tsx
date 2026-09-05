import LoadingScreen from '@/components/LoadingScreen';

import { WalkthroughAdvance } from './WalkthroughAdvance';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: the "building your first five" wait state.
 *
 * In the real flow both onboarding exits (opted into SMS reminders or not) now
 * land here — on `/daily`, whose own load path shows this same `LoadingScreen`
 * while the first queue finishes generating. `?remindersOn=1` (set by the
 * onboarding harness when the reminder ask was accepted) mirrors the real
 * `/daily?remindersOn=1` handoff and renders the confirming note. In `?walk=1`
 * (full-walkthrough) mode it pauses on the build, then advances to the
 * first-session recap — the "first time finished" stage. (Real play itself
 * can't be faithfully stubbed, so the walkthrough brackets it.)
 */
export default async function DevBuildingPage({
  searchParams,
}: {
  searchParams: Promise<{ walk?: string; remindersOn?: string }>;
}) {
  const params = await searchParams;
  const walk = params?.walk === '1';
  const remindersOn = params?.remindersOn === '1';

  return (
    <main className="min-h-dvh">
      <LoadingScreen
        fullScreen
        label="Building your first five…"
        note={
          remindersOn
            ? "You're set — we'll text you when each day's five open."
            : undefined
        }
      />
      {walk ? <WalkthroughAdvance nextHref="/dev/first-time-player" /> : null}
    </main>
  );
}
