import type { ReactNode } from 'react';

import { InviteCategoryChips } from '@/components/invite/InviteCategoryChips';
import { inviteGreatestHitsTitle, safeInviteName } from '@/lib/invite-links';

export function InvitationPageShell({ children }: { children: ReactNode }) {
  return (
    <main className="bg-background text-foreground flex min-h-dvh items-center justify-center px-4 py-8 sm:py-12">
      <section className="bg-card w-full max-w-md overflow-hidden rounded-[var(--radius-card)] border shadow-[var(--shadow-card)]">
        <div className="h-1.5 bg-[var(--accent-gold)]" aria-hidden />
        <div className="p-5 sm:p-7">{children}</div>
      </section>
    </main>
  );
}

export function InvitationLandingContent({
  inviterName: inputName,
  categories,
  action,
}: {
  inviterName?: string | null;
  categories: unknown;
  action: ReactNode;
}) {
  const inviterName = safeInviteName(inputName);
  const invitationLine = inviterName
    ? `${inviterName} invited you to Joshing`
    : 'You’ve been invited to Joshing';
  const explanation = inviterName
    ? `${inviterName} picked a few categories to get you started. We’ll recommend them during setup—you can keep, change, or ignore them.`
    : 'Someone picked a few categories to get you started.';

  return (
    <div className="space-y-5 text-center">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm font-medium break-words">{invitationLine}</p>
        <h1 className="font-serif text-3xl leading-tight font-semibold text-balance break-words text-[var(--brand-navy)] sm:text-4xl">
          {inviteGreatestHitsTitle(inviterName)}
        </h1>
        <p className="text-muted-foreground text-sm leading-6 break-words">{explanation}</p>
      </div>
      <InviteCategoryChips categories={categories} />
      {action}
    </div>
  );
}
