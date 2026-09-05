import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

import OnboardingFlow, { type PreSeededInterest } from '@/app/onboarding/OnboardingFlow';

export const dynamic = 'force-dynamic';

/**
 * Dev harness: replay the real setup (name + call sign) → areas-of-knowledge
 * flow.
 *
 * Mounts the genuine `OnboardingFlow` with `previewMode`, so the setup,
 * interests, and final reminder-ask steps advance through the actual UI but
 * skip their mutating writes (no PATCH /api/account, no save-interests, no
 * real SMS opt-in). Both reminder-ask exits now chain to the "building your
 * first five" preview — matching the real flow, where onboarding always lands
 * on `/daily` and its own load path shows the crafting screen. Driven by mock
 * invite data so the inviter-seeded path renders. In `?walk=1` mode the chain
 * carries the walkthrough flag onward.
 *
 * `?seedSource=link` (Stage 2 of the invite-link build): swaps in the
 * per-user invite-link experience — the same mock topics arrive UNSELECTED as
 * suggestion chips instead of pre-selected, with the "here are a few from
 * {inviter}" copy — since a link may reach someone the inviter never had in
 * mind. Default (omitted) stays the named-invite experience: pre-selected.
 */

const MOCK_INTERESTS: PreSeededInterest[] = [
  { domain: 'Tennis Fundamentals', broadCategory: 'Sports', rationale: 'Maya plays a lot of it.' },
  { domain: 'Early 20th Century American History', broadCategory: 'History', rationale: null },
  { domain: '1980s Toys', broadCategory: 'Pop Culture', rationale: null },
];

export default async function DevOnboardingIntroPage({
  searchParams,
}: {
  searchParams: Promise<{ walk?: string; seedSource?: string }>;
}) {
  const params = await searchParams;
  const walk = params?.walk === '1';
  const seedSource = params?.seedSource === 'link' ? 'link' : 'named';
  const nextHref = walk ? '/dev/onboarding/building?walk=1' : '/dev/onboarding/building';

  return (
    <>
      <div className="fixed top-0 right-0 left-0 z-50 flex items-center justify-between gap-3 bg-[var(--brand-ink-950)] px-4 py-2 text-[var(--primary-foreground)]">
        <Link href="/users/me" className="inline-flex items-center gap-1 text-sm">
          <ChevronLeft className="size-4" />
          Dev tools
        </Link>
        <span className="text-[12px] font-bold tracking-[0.1em] uppercase">
          {walk ? 'Full walkthrough · writes stubbed' : 'Read-only replay · writes stubbed'}
          {seedSource === 'link' ? ' · invite-link seeds' : ''}
        </span>
      </div>
      <div style={{ paddingTop: '2.5rem' }}>
        <OnboardingFlow
          previewMode
          previewNextHref={nextHref}
          seedSource={seedSource}
          preSeededInterests={MOCK_INTERESTS}
          inviterName={seedSource === 'link' ? 'Robyn' : 'Maya'}
          inviteeDisplayName={null}
          initialDisplayName={null}
          initialHandle={null}
            phoneNumber="+17345550123"
            showReminderOffer
        />
      </div>
    </>
  );
}
