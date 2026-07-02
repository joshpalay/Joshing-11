'use client';

import Link from 'next/link';

// One nav for the crafter tool's rooms — Panel B (/admin/crafter), the review
// queue (/admin/reports), and the knowledge-graph authoring surface
// (/admin/knowledge). Shared so the pages read as one tool, not ad-hoc admin
// routes that happen to link at each other.
export function AdminTabs({
  active,
  needingReviewCount,
}: {
  active: 'crafter' | 'reports' | 'knowledge';
  needingReviewCount?: number;
}) {
  const tabClass = 'rounded-md border px-3 py-1.5 text-sm font-medium';
  const activeStyle = { borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' } as const;
  const idleStyle = { borderColor: 'var(--border)', color: 'var(--text-muted)' } as const;

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Crafter sections">
      <Link
        href="/admin/crafter"
        className={tabClass}
        style={active === 'crafter' ? activeStyle : idleStyle}
        aria-current={active === 'crafter' ? 'page' : undefined}
      >
        Where your craft is wanted
      </Link>
      <Link
        href="/admin/reports"
        className={tabClass}
        style={active === 'reports' ? activeStyle : idleStyle}
        aria-current={active === 'reports' ? 'page' : undefined}
      >
        Questions needing you
        {needingReviewCount !== undefined && needingReviewCount > 0 ? (
          <span style={{ color: 'var(--danger)' }}> · {needingReviewCount}</span>
        ) : null}
      </Link>
      <Link
        href="/admin/knowledge"
        className={tabClass}
        style={active === 'knowledge' ? activeStyle : idleStyle}
        aria-current={active === 'knowledge' ? 'page' : undefined}
      >
        Knowledge graph
      </Link>
    </nav>
  );
}
