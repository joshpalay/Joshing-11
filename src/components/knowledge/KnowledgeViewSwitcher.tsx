'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

// Live switch between the three knowledge views. Replaces the old server-side
// KNOWLEDGE_MAP_PAGE env gate: instead of one build-time choice, the player
// flips between them in the browser via ?view=.
//   - peaks    → the leaf-first "what you're smart at" gallery (new)
//   - current  → the nested circle-pack bubble map
//   - previous → the flat portrait page that predates the map
export type KnowledgeView = 'peaks' | 'current' | 'previous';

const OPTIONS: ReadonlyArray<{ view: KnowledgeView; label: string }> = [
  { view: 'peaks', label: 'New' },
  { view: 'current', label: 'Current' },
  { view: 'previous', label: 'Previous' },
];

export function KnowledgeViewSwitcher({ current }: { current: KnowledgeView }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Knowledge view"
      className="mx-auto flex w-fit items-center gap-0.5 rounded-full border p-0.5"
      style={{ borderColor: 'var(--border)', background: 'var(--brand-card)' }}
    >
      {OPTIONS.map(({ view, label }) => {
        const active = view === current;
        return (
          <Link
            key={view}
            href={`${pathname}?view=${view}`}
            aria-current={active ? 'page' : undefined}
            scroll={false}
            className="rounded-full px-3.5 py-1.5 text-[11px] uppercase tracking-[0.08em] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={
              active
                ? { background: 'var(--brand-navy)', color: 'var(--brand-card)' }
                : { color: 'var(--brand-ink-700)' }
            }
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
