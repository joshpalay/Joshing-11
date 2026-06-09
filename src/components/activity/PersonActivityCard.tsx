'use client';

import type { StreamItem } from '@/lib/activity-stream';
import { FF, INK, RULE } from '@/components/lately/tokens';

import { ActivityStreamItem, Line } from './ActivityStreamItem';

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

// Tier 2 + 3 of the home hierarchy: one card gathering everything a single friend
// did. The heading (tier 2) is driven by the strongest relationship signal — a
// convergence ("you and {friend} keep landing in the same place") leads when
// present, otherwise a warm generic line — and the friend's events stack beneath
// it (tier 3). Built only when a friend has ≥2 groupable events in a day bucket
// (see groupActivityByFriend in FeedList); lone events stay ordinary one-liners.
export function PersonActivityCard({
  rows,
  timestampFor,
}: {
  friendId: string;
  rows: StreamItem[];
  timestampFor: (item: StreamItem) => string;
}) {
  // A convergence, when present, becomes the headline and drops out of the
  // sub-items below (it IS the heading, not a duplicate line).
  const convergence = rows.find((r) => r.expand?.kind === 'same_correct') ?? null;
  const subItems = convergence ? rows.filter((r) => r !== convergence) : rows;
  const firstName = firstNameFromRows(rows);

  return (
    <div
      style={{
        border: `1px solid ${RULE}`,
        borderRadius: 4,
        padding: '10px 12px',
        background: 'var(--brand-card)',
      }}
    >
      <p
        style={{
          margin: 0,
          fontFamily: FF,
          fontSize: 15,
          fontWeight: 600,
          lineHeight: 1.4,
          color: INK,
        }}
      >
        {convergence ? <Line parts={convergence.line} /> : `${firstName} gets you!`}
      </p>
      <div style={{ marginTop: 2 }}>
        {subItems.map((item, idx) => (
          <div key={item.id} style={idx > 0 ? { borderTop: `1px solid ${RULE}` } : undefined}>
            <ActivityStreamItem item={item} timestamp={timestampFor(item)} inCard />
          </div>
        ))}
      </div>
    </div>
  );
}
