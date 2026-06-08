import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { getOpenReportsForReview } from '@/server/db/queries/content-reports';

import { AdminReportsClient } from './AdminReportsClient';

export const dynamic = 'force-dynamic';

// B-Report-5: the content-report review queue. Reachable ONLY to ADMIN_USER_IDS
// members; everyone else (incl. authenticated non-admins) gets Next's 404 — the
// route's existence is not revealed. Unset env ⇒ no admins ⇒ always 404.
export default async function AdminReportsPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const reports = await getOpenReportsForReview();
  return <AdminReportsClient reports={reports} />;
}
