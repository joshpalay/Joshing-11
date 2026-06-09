'use client';

import type { StreamItem } from '@/lib/activity-stream';
import { FF, INK, RULE } from '@/components/lately/tokens';

import { ActivityStreamItem, Line } from './ActivityStreamItem';
import { ActivityIcon } from './ActivityIcon';

// Width of the shape column (mark 24 + gap 8), so the nested events indent to sit
// directly under the heading statement's text.
const HEADING_INDENT = 32;

// The friend's first name, pulled from the first actor part of any of their
// rows (convergence uses the first name already; moments/activities carry the
// display name). Falls back to a warm neutral if no actor part is present.
function firstNameFromRows(rows: StreamItem[]): string {
  for (const row of rows) {
    for (const part of row.line) {
      if (part.t === 'actor') {
        const [first] = part.name.trim().split(/\s+/);
        if (first) return first;
      }
    }
  }
  return 'They';
}

// Tier 2 + 3 of the home hierarchy: one quiet (no card) group of everything a
// single friend did. The heading (tier 2) is the relationship statement — a
// convergence ("You and Robyn are clearly on the same page") when present, else a
// warm generic line — and it carries the ONE diamond shape. The friend's events
// nest beneath it (tier 3) as a plain indented list with no shapes of their own.
export function PersonActivityCard({
  rows,
  timestampFor,
}: {
  friendId: string;
  rows: StreamItem[];
  timestampFor: (item: StreamItem) => string;
}) {
  const convergence = rows.find((r) => r.expand?.kind === 'same_correct') ?? null;
  const subItems = convergence ? rows.filter((r) => r !== convergence) : rows;
  const firstName = firstNameFromRows(rows);
  const seed = convergence?.id ?? rows[0]?.id ?? 'person';

  return (
    <div style={{ padding: '12px 2px', borderBottom: `1px solid ${RULE}` }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <ActivityIcon spec={{ kind: 'diamond' }} seed={seed} />
        <p
          style={{
            margin: 0,
            flex: 1,
            minWidth: 0,
            fontFamily: FF,
            fontSize: 15,
            fontWeight: 600,
            lineHeight: 1.4,
            letterSpacing: 0.2,
            color: INK,
          }}
        >
          {convergence ? <Line parts={convergence.line} /> : `${firstName} gets you!`}
        </p>
      </div>
      <div style={{ marginLeft: HEADING_INDENT, marginTop: 2 }}>
        {subItems.map((item) => (
          <ActivityStreamItem key={item.id} item={item} timestamp={timestampFor(item)} nested />
        ))}
      </div>
    </div>
  );
}
