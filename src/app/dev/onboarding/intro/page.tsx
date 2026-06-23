import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import OnboardingFlow, { type PreSeededInterest } from '@/app/onboarding/OnboardingFlow';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: replay the real name → call sign → areas-of-knowledge flow.
 *
 * Mounts the genuine `OnboardingFlow` with `previewMode`, so the name/handle/
 * interests steps advance through the actual UI but skip their mutating writes
 * (no PATCH /api/account, no save-interests). Finishing the areas step chains to
 * the welcome-tour preview instead of the live home. Driven by mock invite data
 * so the inviter-seeded path renders.
 */

const MOCK_INTERESTS: PreSeededInterest[] = [
  { domain: 'Tennis Fundamentals', broadCategory: 'Sports', rationale: 'Maya plays a lot of it.' },
  { domain: 'Early 20th Century American History', broadCategory: 'History', rationale: null },
  { domain: '1980s Toys', broadCategory: 'Pop Culture', rationale: null },
];

export default function DevOnboardingIntroPage() {
  return (
    <>
      <div className="fixed top-0 right-0 left-0 z-50 flex items-center justify-between gap-3 bg-[var(--brand-ink-950)] px-4 py-2 text-[var(--primary-foreground)]">
        <Link href="/dev/onboarding" className="inline-flex items-center gap-1 text-sm">
          <ChevronLeft className="size-4" />
          Stages
        </Link>
        <span className="text-[12px] font-bold tracking-[0.1em] uppercase">
          Read-only replay · writes stubbed
        </span>
      </div>
      <div style={{ paddingTop: '2.5rem' }}>
        <OnboardingFlow
          previewMode
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
