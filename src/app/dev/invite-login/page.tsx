'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Info } from 'lucide-react';

import LoginPanel from '@/app/login/LoginPanel';

/**
 * Dev tool: preview the phone-first invite login (D-AUTH-INVITE-PHONE-FIRST).
 *
 * Linked from the Developer tools section of the profile page. It renders the
 * real `LoginPanel` with synthetic invite data so the two new surfaces — the
 * confirm-your-number screen (Screen 1) and the warm "not my number" dead-end
 * (Screen 1b) — can be inspected WITHOUT minting a real invitation or sending
 * an OTP. It is look-only: the synthetic token doesn't resolve server-side, so
 * the buttons won't complete a login (no account is created). The dead-end is
 * seeded via LoginPanel's dev-only `previewDeadEnd` prop rather than a live
 * failed gate round-trip.
 */

// Synthetic prefill — the (734) 555-6819 number matches the design spec's
// worked example. `inviterUserId`/`inviterAvatarColor` are only used by the
// (unrendered-here) inviter avatar, so placeholder values are fine.
const PREVIEW_INVITER = {
  inviterName: 'Greg Sample',
  inviterUserId: 'dev-preview-inviter',
  inviterAvatarColor: null,
};
const PREVIEW_PREFILL = { ...PREVIEW_INVITER, inviteePhone: '+17345556819' };

type PreviewScreen = 'phone' | 'deadEnd';

export default function DevInviteLoginPage() {
  const [screen, setScreen] = useState<PreviewScreen>('phone');

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/users/me"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>

      <h1 className="mt-6 font-serif text-3xl leading-tight font-semibold">
        Phone-first invite login
      </h1>

      <div className="mt-4 flex gap-3 rounded-xl border border-[var(--brand-border)] bg-[var(--brand-card)] p-4 text-card-foreground">
        <Info className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
        <div className="text-sm leading-6 text-muted-foreground">
          <p className="font-medium text-foreground">
            What an invited friend sees when they tap their invite link.
          </p>
          <p className="mt-1">
            The invited number is shown as a value to confirm with one tap. It
            isn&apos;t editable &mdash; the invite is phone-bound, so if it
            isn&apos;t their number they get the warm dead-end pointing them back
            to the inviter for a new invite instead of a hard error. This is a
            look-only preview with synthetic data &mdash; no invitation is
            created and no code is sent, so the buttons won&apos;t complete a
            real login.
          </p>
        </div>
      </div>

      {/* Toggle between the two new surfaces. */}
      <div className="mt-6 flex gap-2" role="tablist" aria-label="Preview screen">
        <PreviewTab
          active={screen === 'phone'}
          onClick={() => setScreen('phone')}
          label="Screen 1 — confirm number"
        />
        <PreviewTab
          active={screen === 'deadEnd'}
          onClick={() => setScreen('deadEnd')}
          label="Screen 1b — not my number"
        />
      </div>

      {/* Render the real LoginPanel so the preview can never drift from prod.
          `key` remounts it on toggle so the seeded step/dead-end state resets. */}
      <div className="mt-6 flex justify-center">
        <Suspense fallback={null}>
          <LoginPanel
            key={screen}
            invitePrefill={PREVIEW_PREFILL}
            inviteContext={PREVIEW_INVITER}
            previewDeadEnd={screen === 'deadEnd'}
          />
        </Suspense>
      </div>
    </main>
  );
}

function PreviewTab({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? 'border-[var(--brand-navy)] bg-[var(--brand-navy)] text-white'
          : 'border-[var(--brand-border)] text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}
