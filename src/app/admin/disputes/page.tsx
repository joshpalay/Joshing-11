import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { getPendingGradeDisputesForReview } from '@/server/db/queries/grade-disputes';

import { AdminDisputesClient } from './AdminDisputesClient';

export const dynamic = 'force-dynamic';

// B-13.4 — every recheck route (daily, catch-up, feed, Lately milestone) files
// a GradeDispute row when a recheck doesn't cleanly auto-resolve (accept), but
// nothing read those rows back before this page existed — they piled up
// invisibly. This is the minimal queue that closes that gap: list what's
// pending, let an admin mark it reviewed or dismissed. Same admin gate as
// every other /admin page: unlisted admins get Next's 404, never a 403.
export default async function AdminDisputesPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const disputes = await getPendingGradeDisputesForReview();
  return <AdminDisputesClient disputes={disputes} />;
}
