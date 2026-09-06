import LoadingScreen from '@/components/LoadingScreen';

import { WalkthroughAdvance } from './WalkthroughAdvance';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: the "building your first five" wait state.
 *
 * In the real flow both onboarding exits (opted into SMS reminders or not) now
 * land here — on `/daily`, whose own load path shows this same `LoadingScreen`
 * while the first queue finishes generating. In `?walk=1` (full-walkthrough)
 * mode it pauses on the build, then advances to the first-session recap — the
 * "first time finished" stage. (Real play itself can't be faithfully stubbed,
 * so the walkthrough brackets it.)
 *
 * Deliberately does NOT preview ReminderConfirmedToast. That toast renders at
 * --z-toast (70), below this screen's --z-takeover (80), so it would sit
 * invisible behind the loader here — and in production it is gated on loading
 * having finished for exactly that reason. It belongs to the screen AFTER this
 * one, so previewing it here would show a state that never occurs.
 */
export default async function DevBuildingPage({
  searchParams,
}: {
  searchParams: Promise<{ walk?: string }>;
}) {
  const params = await searchParams;
  const walk = params?.walk === '1';

  return (
    <main className="min-h-dvh">
      <LoadingScreen fullScreen label="Building your first five…" />
      {walk ? <WalkthroughAdvance nextHref="/dev/first-time-player" /> : null}
    </main>
  );
}
