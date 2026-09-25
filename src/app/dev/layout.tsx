import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';

import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';

export const dynamic = 'force-dynamic';

// Admin-gated against the ADMIN_USER_IDS allowlist (D-DESIGN-DEBT-STRUCTURAL-01,
// Phase 3), mirroring the admin/reports guard: non-admins get Next's 404 so the
// routes' existence is not revealed. Restored 2026-09-25 after a temporary
// ungate (fc7554a7, 2026-06-22). Setting `DEV_ROUTES_UNGATED` to `true` opens
// /dev to any signed-in user again; the matching settings-menu gate lives in
// src/components/profile/settings/AccountActions.tsx — keep both in step.
// (Unauthenticated visitors 404 regardless, except in local development.)
const DEV_ROUTES_UNGATED = false;

export default async function DevLayout({ children }: { children: ReactNode }) {
  const session = await getSession();
  if (!session && process.env.NODE_ENV === 'development') return <>{children}</>;
  if (!session || (!DEV_ROUTES_UNGATED && !isAdminUser(session.userId))) notFound();
  return <>{children}</>;
}
