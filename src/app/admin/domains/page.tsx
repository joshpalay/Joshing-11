import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import { getDomainFragmentationCandidates } from '@/server/db/queries/domain-fragmentation';

import { AdminTabs } from '../AdminTabs';
import { DomainMergeClient } from './DomainMergeClient';

export const dynamic = 'force-dynamic';

// The interactive counterpart to the weekly domain-fragmentation email
// (B-DOMAIN-FRAGMENT-MERGE-01). That digest is report-only — it can't mutate a
// label — so the merge decisions it surfaces had to be made by hand-editing
// scripts/merge-fragmented-domains.ts and running it. This page lets an admin make
// each call in the browser: for every near-duplicate pair, pick the surviving
// label (or leave the pair), preview the exact row census, then apply — the same
// transaction the CLI runs, via the shared applier. Same admin gate as every
// /admin page: ADMIN_USER_IDS or a 404 that never reveals the route.
export default async function AdminDomainsPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  // Same candidate query the weekly email uses, so the page and the digest agree.
  const pairs = await getDomainFragmentationCandidates();

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4">
        <AdminTabs active="domains" />
        <div>
          <h1 className="font-serif text-2xl font-semibold" style={{ color: 'var(--brand-ink)' }}>
            Merge suggestions
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Pairs of near-duplicate <strong>labels from the question corpus</strong>, matched by
            spelling. For each pair, decide: the <strong>same thing</strong> → merge them into one
            spelling; <strong>one inside the other</strong> → nest it; <strong>genuinely
            different</strong> → dismiss the pair for good. Merges and nests show a few-second
            Undo before committing; a dismiss is permanent. Tap <em>see</em> on either side to
            read its actual questions before deciding.
          </p>
        </div>
      </div>

      <DomainMergeClient pairs={pairs} />
    </main>
  );
}
