import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getSession } from '@/server/auth/session';
import { isAdminUser } from '@/server/auth/admin';
import {
  getBlockedQuestionsForReview,
  getOpenReportsForReview,
} from '@/server/db/queries/content-reports';
import { getMachineDemotionsForReview } from '@/server/db/queries/machine-demotions';
import { getDomainFragmentationCandidates } from '@/server/db/queries/domain-fragmentation';
import { getAllQuestionsForAdmin } from '@/server/db/queries/admin-questions';
import { listKnowledgeGraph } from '@/server/db/queries/knowledge-graph';
import { getCrafterWorklist } from '@/server/db/queries/crafter-demand';
import { buildSupplyCoverageSummary } from '@/server/daily/supply-coverage';

import { AdminTabs } from './AdminTabs';

export const dynamic = 'force-dynamic';

// The admin landing — "where is the work?" at a glance, grouped by the four
// jobs the tool does (Review / Author / Library / Domains) so the cards mirror
// the nav. Each card carries the live counts its page computes; every read is
// fail-open (a card shows "—" instead of breaking the others) and reuses the
// exact query its page uses, so the numbers here always agree with the pages.
// Same admin gate as every /admin page: ADMIN_USER_IDS or a 404 that never
// reveals the route.

type CardStat = { value: string; label: string; tone?: 'danger' | 'navy' };

function StatChip({ stat }: { stat: CardStat }) {
  const color =
    stat.tone === 'danger'
      ? 'var(--danger)'
      : stat.tone === 'navy'
        ? 'var(--brand-navy)'
        : 'var(--brand-ink)';
  return (
    <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
      <strong style={{ color }}>{stat.value}</strong> {stat.label}
    </span>
  );
}

function OverviewCard({
  href,
  title,
  description,
  stats,
}: {
  href: string;
  title: string;
  description: string;
  stats: CardStat[];
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-md border p-4 transition-colors hover:border-[var(--brand-navy)]"
      style={{ borderColor: 'var(--border)' }}
    >
      <span className="font-serif text-lg font-semibold" style={{ color: 'var(--brand-navy)' }}>
        {title}
      </span>
      <span className="text-sm leading-snug" style={{ color: 'var(--text-muted)' }}>
        {description}
      </span>
      <span className="mt-auto flex flex-wrap gap-x-4 gap-y-1 pt-1">
        {stats.map((stat, i) => (
          <StatChip key={i} stat={stat} />
        ))}
      </span>
    </Link>
  );
}

function GroupHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2
      className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] first:mt-0"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </h2>
  );
}

export default async function AdminOverviewPage() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) notFound();

  // Every read independent + fail-open: one broken surface must not blank the
  // other cards. null ⇒ that card renders "—".
  const [reports, demotions, blocked, supply, mergePairs, graph, questionsPage, crafterWorklist] =
    await Promise.all([
      getOpenReportsForReview().catch(() => null),
      getMachineDemotionsForReview().catch(() => null),
      getBlockedQuestionsForReview().catch(() => null),
      buildSupplyCoverageSummary(), // fail-open internally (returns null)
      getDomainFragmentationCandidates().catch(() => null),
      listKnowledgeGraph().catch(() => null),
      getAllQuestionsForAdmin({ pageSize: 1 }).catch(() => null),
      getCrafterWorklist(session.userId).catch(() => null),
    ]);

  const n = (value: number | null | undefined): string =>
    value == null ? '—' : value.toLocaleString();

  const openCount =
    reports === null && demotions === null
      ? null
      : (reports?.length ?? 0) + (demotions?.length ?? 0);
  const readyFixCount = demotions?.filter((d) => d.proposal).length ?? null;
  const highNeedCount = crafterWorklist?.filter((row) => row.heat === 'high').length ?? null;

  return (
    <main className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4">
        <AdminTabs active="overview" />
        <div>
          <h1 className="font-serif text-2xl font-semibold" style={{ color: 'var(--brand-ink)' }}>
            Overview
          </h1>
          <p className="mt-1 text-sm" style={{ color: 'var(--text-muted)' }}>
            Where the work is, across every admin surface. Counts are live and match each page.
          </p>
        </div>
      </div>

      <GroupHeading>Review</GroupHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <OverviewCard
          href="/admin/reports"
          title="Review queue"
          description="Player reports and verifier demotions waiting on a human call."
          stats={[
            { value: n(openCount), label: 'needing review', tone: openCount ? 'danger' : undefined },
            { value: n(readyFixCount), label: 'with a ready fix', tone: readyFixCount ? 'navy' : undefined },
            { value: n(blocked?.length), label: 'blocked / actioned' },
          ]}
        />
      </div>

      <GroupHeading>Author</GroupHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <OverviewCard
          href="/admin/crafter"
          title="Write questions"
          description="Where your craft is wanted — active domains ranked by how much hand-authoring would matter."
          stats={[
            {
              value: n(highNeedCount),
              label: 'domains in high need',
              tone: highNeedCount ? 'danger' : undefined,
            },
            { value: n(crafterWorklist?.length), label: 'active domains' },
          ]}
        />
        <OverviewCard
          href="/admin/bulk-upload"
          title="Import CSV"
          description="Create questions in bulk from a CSV. Uploads publish immediately as verified and public."
          stats={[]}
        />
      </div>

      <GroupHeading>Library</GroupHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <OverviewCard
          href="/admin/questions"
          title="Questions"
          description="The full canonical pool — inspect, edit, soft-delete."
          stats={[{ value: n(questionsPage?.total), label: 'questions' }]}
        />
      </div>

      <GroupHeading>Domains</GroupHeading>
      <div className="grid gap-3 sm:grid-cols-2">
        <OverviewCard
          href="/admin/knowledge"
          title="Tree"
          description="The authored territory structure — nodes, edges, mastery targets."
          stats={[
            { value: n(graph?.nodes.length), label: 'territories' },
            { value: n(graph?.edges.length), label: 'edges' },
          ]}
        />
        <OverviewCard
          href="/admin/supply"
          title="Supply"
          description="Size estimates vs realized generation — which domains ran dry early, and which beat their estimates."
          stats={[
            {
              value: n(supply?.counts.discrepancy),
              label: 'ran dry early',
              tone: supply?.counts.discrepancy ? 'danger' : undefined,
            },
            {
              value: n(supply?.counts.raise_estimate),
              label: 'estimate too low',
              tone: supply?.counts.raise_estimate ? 'navy' : undefined,
            },
            { value: n(supply?.cappedCount), label: 'capped' },
          ]}
        />
        <OverviewCard
          href="/admin/domains"
          title="Merge suggestions"
          description="Near-duplicate labels awaiting a call: merge, nest, or dismiss. The tree follows a merge automatically."
          stats={[
            {
              value: n(mergePairs?.length),
              label: 'candidate pairs',
              tone: mergePairs?.length ? 'navy' : undefined,
            },
          ]}
        />
      </div>
    </main>
  );
}
