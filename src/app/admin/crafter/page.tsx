import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { getCrafterWorklist } from '@/server/db/queries/crafter-demand';
import { getOpenReportsForReview } from '@/server/db/queries/content-reports';
import { getMachineDemotionsForReview } from '@/server/db/queries/machine-demotions';

import { CrafterClient } from './CrafterClient';

export const dynamic = 'force-dynamic';

// B-CRAFTER-LIFECYCLE-01 Phase 2: the crafter home. Panel B ("where your craft
// is wanted") ranks active-but-thin domains and opens the creation surface;
// Panel A (the merged review queue) lives at /admin/reports and is linked with
// a live count. Same gate contract as the other admin pages: ADMIN_USER_IDS or
// Next's 404 — the route's existence is not revealed.
export default async function AdminCrafterPage({
  searchParams,
}: {
  searchParams: Promise<{ domain?: string }>;
}) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  const [worklist, reports, demotions, params] = await Promise.all([
    getCrafterWorklist(session.userId),
    getOpenReportsForReview(),
    getMachineDemotionsForReview(),
    searchParams,
  ]);

  return (
    <CrafterClient
      worklist={worklist}
      needingReviewCount={reports.length + demotions.length}
      initialDomain={params.domain ?? null}
    />
  );
}
