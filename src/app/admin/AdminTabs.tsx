'use client';

import Link from 'next/link';

// One nav for the crafter tool's two rooms — Panel B (/admin/crafter) and the
// review queue (/admin/reports). Shared so the two pages read as one tool, not
// two ad-hoc admin routes that happen to link at each other.
export function AdminTabs({
  active,
  needingReviewCount,
}: {
  active: 'crafter' | 'reports';
  needingReviewCount: number;
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
        {needingReviewCount > 0 ? (
          <span style={{ color: 'var(--danger)' }}> · {needingReviewCount}</span>
        ) : null}
      </Link>
    </nav>
  );
}
