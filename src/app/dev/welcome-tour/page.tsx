import WelcomeTourScreen from '@/components/welcome/WelcomeTourScreen';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: replay the welcome tour overview in isolation.
 *
 * Mounts the self-contained `WelcomeTourScreen` (its own mock home + nav), so
 * every callout resolves and the For-You sample is populated. `forced` bypasses
 * — and never writes — the seen-flag. A sample inviter name stands in for the
 * real one.
 *
 * In `?walk=1` (full-walkthrough) mode, "Play Now" chains into the building
 * state; otherwise it goes to the round. "Explore" returns to the harness hub.
 */
export default async function DevWelcomeTourPage({
  searchParams,
}: {
  searchParams: Promise<{ walk?: string }>;
}) {
  const params = await searchParams;
  const walk = params?.walk === '1';

  return (
    <WelcomeTourScreen
      forced
      inviterName="Maya"
      playHref={walk ? '/dev/onboarding/building?walk=1' : '/daily'}
      exploreHref="/dev/onboarding"
    />
  );
}
