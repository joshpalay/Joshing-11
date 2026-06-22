import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

// TEMP (ungate): the /dev tree is currently session-gated only — any
// authenticated user can reach the dev tools (reset-session, noon-reset,
// points-diagnostic, flags, first-time-player, invite-login, …) by URL.
//
// Normally (D-DESIGN-DEBT-STRUCTURAL-01, Phase 3) this is admin-gated against
// the ADMIN_USER_IDS allowlist, mirroring the admin/reports guard, so non-admins
// get Next's 404 and the routes' existence is not revealed. To restore that,
// flip `DEV_ROUTES_UNGATED` back to `false`. The matching settings-menu gate
// lives in src/components/profile/settings/AccountActions.tsx; revert both
// together. (Unauthenticated visitors still 404 regardless.)
const DEV_ROUTES_UNGATED = true;

export default async function DevLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session || (!DEV_ROUTES_UNGATED && !isAdminUser(session.userId))) notFound();
  return <>{children}</>;
}
