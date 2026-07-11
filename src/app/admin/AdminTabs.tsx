'use client';

import Link from 'next/link';

// The admin nav, organized around the four JOBS the tool does rather than one
// flat route list (D-ADMIN-USABILITY-01):
//   Review queue — flagged/demoted questions waiting on a human call
//   Author       — write questions by hand (Crafter) or import a CSV
//   Library      — the full question pool audit table
//   Domains      — one subject-structure section with three views:
//                  Tree (knowledge graph) · Supply · Merge suggestions
// Pages keep their existing routes and `active` keys; this component maps each
// key to its section and, where a section has views, renders a second row of
// sub-tabs styled as underline links so they can't be mistaken for top nav.
export type AdminTabKey =
  | 'overview'
  | 'crafter'
  | 'bulk-upload'
  | 'reports'
  | 'knowledge'
  | 'questions'
  | 'supply'
  | 'domains';

type Section = 'overview' | 'review' | 'author' | 'library' | 'domains';

const SECTION_OF: Record<AdminTabKey, Section> = {
  overview: 'overview',
  reports: 'review',
  crafter: 'author',
  'bulk-upload': 'author',
  questions: 'library',
  knowledge: 'domains',
  supply: 'domains',
  domains: 'domains',
};

const SECTIONS: Array<{ key: Section; label: string; href: string }> = [
  { key: 'overview', label: 'Overview', href: '/admin' },
  { key: 'review', label: 'Review queue', href: '/admin/reports' },
  { key: 'author', label: 'Author', href: '/admin/crafter' },
  { key: 'library', label: 'Library', href: '/admin/questions' },
  { key: 'domains', label: 'Domains', href: '/admin/knowledge' },
];

const SUBTABS: Partial<Record<Section, Array<{ key: AdminTabKey; label: string; href: string }>>> =
  {
    author: [
      { key: 'crafter', label: 'Write questions', href: '/admin/crafter' },
      { key: 'bulk-upload', label: 'Import CSV', href: '/admin/bulk-upload' },
    ],
    domains: [
      { key: 'knowledge', label: 'Tree', href: '/admin/knowledge' },
      { key: 'supply', label: 'Supply', href: '/admin/supply' },
      { key: 'domains', label: 'Merge suggestions', href: '/admin/domains' },
    ],
  };

export function AdminTabs({
  active,
  needingReviewCount,
}: {
  active: AdminTabKey;
  needingReviewCount?: number;
}) {
  const activeSection = SECTION_OF[active];
  const subtabs = SUBTABS[activeSection];

  const tabClass = 'rounded-md border px-3 py-1.5 text-sm font-medium';
  const activeStyle = { borderColor: 'var(--brand-navy)', color: 'var(--brand-navy)' } as const;
  const idleStyle = { borderColor: 'var(--border)', color: 'var(--text-muted)' } as const;

  return (
    <div className="flex flex-col gap-2">
      <nav className="flex flex-wrap gap-2" aria-label="Admin sections">
        {SECTIONS.map((section) => (
          <Link
            key={section.key}
            href={section.href}
            className={tabClass}
            style={activeSection === section.key ? activeStyle : idleStyle}
            aria-current={activeSection === section.key ? 'page' : undefined}
          >
            {section.label}
            {section.key === 'review' &&
            needingReviewCount !== undefined &&
            needingReviewCount > 0 ? (
              <span style={{ color: 'var(--danger)' }}> · {needingReviewCount}</span>
            ) : null}
          </Link>
        ))}
      </nav>
      {subtabs ? (
        // Sub-views of the active section — underline style, deliberately
        // different from the bordered top tabs so the two levels read apart.
        <nav
          className="flex flex-wrap gap-4 border-b pb-1"
          style={{ borderColor: 'var(--border)' }}
          aria-label={`${SECTIONS.find((s) => s.key === activeSection)?.label ?? 'Section'} views`}
        >
          {subtabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              className="-mb-1.5 border-b-2 px-0.5 pb-1 text-sm font-medium"
              style={
                active === tab.key
                  ? { borderColor: 'var(--brand-navy)', color: 'var(--brand-ink)' }
                  : { borderColor: 'transparent', color: 'var(--text-muted)' }
              }
              aria-current={active === tab.key ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
