import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import OnboardingFlow, { type PreSeededInterest } from '@/app/onboarding/OnboardingFlow';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: replay the real setup (name + call sign) → areas-of-knowledge
 * flow.
 *
 * Mounts the genuine `OnboardingFlow` with `previewMode`, so the setup and
 * interests steps advance through the actual UI but skip their mutating writes
 * (no PATCH /api/account, no save-interests). Finishing the areas step chains to
 * the welcome-tour preview. Driven by mock invite data so the inviter-seeded
 * path renders. In `?walk=1` mode the chain carries the walkthrough flag onward.
 */

const MOCK_INTERESTS: PreSeededInterest[] = [
  { domain: 'Tennis Fundamentals', broadCategory: 'Sports', rationale: 'Maya plays a lot of it.' },
  { domain: 'Early 20th Century American History', broadCategory: 'History', rationale: null },
  { domain: '1980s Toys', broadCategory: 'Pop Culture', rationale: null },
];

export default async function DevOnboardingIntroPage({
  searchParams,
}: {
  searchParams: Promise<{ walk?: string }>;
}) {
  const params = await searchParams;
  const walk = params?.walk === '1';
  const nextHref = walk ? '/dev/welcome-tour?walk=1' : '/dev/welcome-tour';

  return (
    <>
      <div className="fixed top-0 right-0 left-0 z-50 flex items-center justify-between gap-3 bg-[var(--brand-ink-950)] px-4 py-2 text-[var(--primary-foreground)]">
        <Link href="/dev/onboarding" className="inline-flex items-center gap-1 text-sm">
          <ChevronLeft className="size-4" />
          Stages
        </Link>
        <span className="text-[12px] font-bold tracking-[0.1em] uppercase">
          {walk ? 'Full walkthrough · writes stubbed' : 'Read-only replay · writes stubbed'}
        </span>
      </div>
      <div style={{ paddingTop: '2.5rem' }}>
        <OnboardingFlow
          previewMode
          previewNextHref={nextHref}
          preSeededInterests={MOCK_INTERESTS}
          inviterName="Maya"
          inviteeDisplayName={null}
          initialDisplayName={null}
          initialHandle={null}
        />
      </div>
    </>
  );
}
