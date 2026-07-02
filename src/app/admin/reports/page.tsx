import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import {
  getBlockedQuestionsForReview,
  getOpenReportsForReview,
} from '@/server/db/queries/content-reports';
import { getMachineDemotionsForReview } from '@/server/db/queries/machine-demotions';

import { AdminReportsClient } from './AdminReportsClient';

export const dynamic = 'force-dynamic';

// B-Report-5/6 + B-CRAFTER-LIFECYCLE-01 Phase 1: the review queue merges BOTH
// quality streams — player content-reports and machine demotions (the batch
// verifier's needs_review rows) — plus the blocked/actioned review. Reachable
// ONLY to ADMIN_USER_IDS members; everyone else (incl. authenticated
// non-admins) gets Next's 404 — the route's existence is not revealed. Unset env
// ⇒ no admins ⇒ always 404.
export default async function AdminReportsPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const [reports, demotions, blocked] = await Promise.all([
    getOpenReportsForReview(),
    getMachineDemotionsForReview(),
    getBlockedQuestionsForReview(),
  ]);
  return <AdminReportsClient reports={reports} demotions={demotions} blocked={blocked} />;
}
