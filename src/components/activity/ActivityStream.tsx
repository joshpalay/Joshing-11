'use client';

import { Fragment } from 'react';

import { DayDivider } from '@/components/lately/DayDivider';
import { FM, INK3, RULE } from '@/components/lately/tokens';
import type { StreamItem } from '@/lib/activity-stream';
import { bucketByDay, formatMomentTime, partitionPinnedRequests } from '@/lib/lately';

import { ActivityStreamItem } from './ActivityStreamItem';

function relativeTime(value: Date): string {
  const diffMs = Date.now() - value.getTime();
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `${weeks}w`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

// The SAME quiet one-liner stream, rendered two ways:
//   - variant="home": the flat, relative-timestamped HEAD on "What's Happening".
//   - variant="full": the day-bucketed FULL list on Lately / /activities.
// Both draw from the identical StreamItem[] (see buildActivityStream) and render
// the identical row component — only the surrounding chrome differs.
export function ActivityStream({
  items,
  variant,
  tz = 'America/New_York',
}: {
  items: StreamItem[];
  variant: 'home' | 'full';
  tz?: string;
}) {
  if (variant === 'home') {
    return (
      <div>
        {items.map((item) => (
          <ActivityStreamItem
            key={item.id}
            item={item}
            timestamp={relativeTime(item.sortAt)}
          />
        ))}
      </div>
    );
  }

  // Pending friend requests pin to the very top, above the day buckets, and stay
  // until approved/declined — no matter how old (so a request never rots in an
  // EARLIER bucket). The remaining items bucket by day as before.
  const { pinned, rest } = partitionPinnedRequests(items);
  const buckets = bucketByDay(rest, (i) => i.sortAt, tz);
  return (
    <>
      {pinned.length > 0 ? (
        <>
          <DayDivider label="FRIEND REQUESTS" />
          {pinned.map((item) => (
            <ActivityStreamItem
              key={item.id}
              item={item}
              timestamp={relativeTime(item.sortAt)}
            />
          ))}
        </>
      ) : null}

      {buckets.map((bucket) => (
        <Fragment key={bucket.label}>
          <DayDivider label={bucket.label} />
          {bucket.items.map((item) => (
            <ActivityStreamItem
              key={item.id}
              item={item}
              timestamp={formatMomentTime(item.sortAt, bucket.label, tz)}
            />
          ))}
        </Fragment>
      ))}

      <div
        style={{
          marginTop: 36,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 12,
        }}
      >
        <div style={{ width: 40, height: 1, background: RULE }} />
        <div style={{ fontSize: 9, fontFamily: FM, color: INK3, letterSpacing: 3 }}>
          END OF FEED
        </div>
        <div style={{ width: 40, height: 1, background: RULE }} />
      </div>
    </>
  );
}
