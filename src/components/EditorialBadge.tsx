import type { CSSProperties } from 'react';

import { HOUSE_AUTHOR } from '@/lib/questions-types';

/**
 * D-3 — the persistent non-human marker that renders wherever the house author's
 * name ("Joshing") appears (Invariant H-2). It is deliberately a small, quiet
 * editorial pill, NOT a peer/profile affordance: the house author is content
 * infrastructure, never a followable person.
 *
 * The label text is sourced from the single HOUSE_AUTHOR constant so the badge
 * and the name can never drift apart.
 */
export function EditorialBadge({ style }: { style?: CSSProperties }) {
  return (
    <span
      data-testid="editorial-badge"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.5rem',
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
        borderRadius: '999px',
        padding: '1px 6px',
        lineHeight: 1.4,
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
        ...style,
      }}
    >
      {HOUSE_AUTHOR.label}
    </span>
  );
}
