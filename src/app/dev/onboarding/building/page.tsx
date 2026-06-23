import LoadingScreen from '@/components/LoadingScreen';

import { WalkthroughAdvance } from './WalkthroughAdvance';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: the "building your first five" wait state.
 *
 * In the real flow this is the loading screen shown when the player taps Play
 * before generation has finished (generation kicks off after areas of knowledge,
 * in the background). Here it renders the live `LoadingScreen`. In `?walk=1`
 * (full-walkthrough) mode it pauses on the build, then advances to the
 * first-session recap — the "first time finished" stage. (Real play itself can't
 * be faithfully stubbed, so the walkthrough brackets it.)
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
