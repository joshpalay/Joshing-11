import type { StreamItem } from '@/lib/activity-stream'

// A merged home-feed row, as far as per-person grouping cares: a non-activity
// row (a paginated question card) or an interleaved activity row carrying a
// StreamItem. Generic over the feed-card payload so FeedList keeps its own type.
export type GroupInputRow<TFeed> =
  | { kind: 'feed'; sortMs: number; source_event_at: string; item: TFeed }
  | { kind: 'activity'; sortMs: number; source_event_at: string; item: StreamItem }

// The grouping output: every input row, plus a per-person card that gathers one
// friend's relationship activity within a day bucket.
export type GroupedRow<TFeed> =
  | GroupInputRow<TFeed>
  | {
      kind: 'person'
      friendId: string
      rows: StreamItem[]
      sortMs: number
      source_event_at: string
    }

// The friend a row can be grouped under, or null if it must stay standalone:
// feed cards (playable questions), milestone triangle cards, promo/embed rows,
// and friend-less activity ("You shared…", "Everyone played…") are never grouped.
export function groupableFriendId<TFeed>(row: GroupInputRow<TFeed>): string | null {
  if (row.kind !== 'activity') return null
  const item = row.item
  if (item.expand?.kind === 'milestone') return null
  if (item.embed) return null
  return item.friendId ?? null
}

// Per-person grouping, run within ONE recency bucket so a friend's events never
// merge across a day label. A friend with ≥2 groupable events in the bucket
// collapses into a single person card placed at their newest event's slot; a lone
// event stays an ordinary one-liner in place. Everything non-groupable passes
// through untouched and keeps its position.
export function groupActivityByFriend<TFeed>(
  rows: GroupInputRow<TFeed>[],
): GroupedRow<TFeed>[] {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const fid = groupableFriendId(row)
    if (fid) counts.set(fid, (counts.get(fid) ?? 0) + 1)
  }
  const out: GroupedRow<TFeed>[] = []
  const carded = new Set<string>()
  for (const row of rows) {
    const fid = groupableFriendId(row)
    if (!fid || (counts.get(fid) ?? 0) < 2) {
      out.push(row)
      continue
    }
    if (carded.has(fid)) continue
    carded.add(fid)
    // Gather all of this friend's groupable events (rows are newest-first, so the
    // first is the newest and lends the card its chronological slot).
    const members = rows
      .filter((r) => groupableFriendId(r) === fid)
      .map((r) => (r as Extract<GroupInputRow<TFeed>, { kind: 'activity' }>).item)
    out.push({
      kind: 'person',
      friendId: fid,
      rows: members,
      source_event_at: row.source_event_at,
      sortMs: row.sortMs,
    })
  }
  return out
}
