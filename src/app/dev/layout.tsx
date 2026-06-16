import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

// D-DESIGN-DEBT-STRUCTURAL-01, Phase 3 — gate the entire /dev tree.
//
// Before this, /dev/* (reset-session, noon-reset, points-diagnostic, flags,
// first-time-player, invite-login, loading-preview, test-game) was only
// session-gated: any authenticated non-admin could reach the dev tools by URL,
// even once the settings entry point was hidden. This mirrors the admin/reports
// guard — members of the ADMIN_USER_IDS allowlist only; everyone else (incl.
// authenticated non-admins) gets Next's 404, so the routes' existence is not
// revealed. Unset env ⇒ no admins ⇒ always 404 (fail closed).
export default async function DevLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();
  return <>{children}</>;
}
