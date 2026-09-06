import type { LatelyDirection, LatelyMoment } from '@/server/db/queries/lately';

export type LatelyBucketLabel = 'TODAY' | 'YESTERDAY' | 'EARLIER THIS WEEK';

// Prominence tiers (D-4 §C). Lower number = higher prominence. The Lately feed
// sorts by tier BEFORE recency, so a flood of friend-skill milestones can never
// push a "they_got_you" (someone answered your authored question) or a
// niche-match discovery item out of view within its day bucket.
export const LATELY_TIER = {
  ANSWERED_YOU: 0, // they_got_you — someone answered YOUR authored question
  NICHE_MATCH: 1, // niche-match stranger discovery
  MILESTONE: 2, // friend skill milestones (deep + breadth)
  OTHER: 3, // you_got_them moments and everything else
} as const;

export type LatelyTier = (typeof LATELY_TIER)[keyof typeof LATELY_TIER];

export function latelyTierForMomentDir(dir: LatelyDirection): LatelyTier {
  return dir === 'they_got_you' ? LATELY_TIER.ANSWERED_YOU : LATELY_TIER.OTHER;
}

// Stable prominence sort: tier ascending (most prominent first), then most
// recent first within a tier. Applied before day-bucketing, so each day bucket
// preserves the tier ordering.
export function sortByProminence<T extends { tier: number; sortAt: Date }>(
  items: T[],
): T[] {
  return [...items].sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return b.sortAt.getTime() - a.sortAt.getTime();
  });
}

// Pending friend requests are PINNED above the day buckets in Lately and stay
// there until acted on, regardless of age — a tier bump alone wouldn't do it,
// since an older request would still fall into the YESTERDAY/EARLIER day bucket
// and scroll out of view. A stream row is a pinnable pending request exactly
// when it carries the inline `friend_request` action (set only for requests
// awaiting THIS viewer's approval). `rest` keeps its incoming (prominence)
// order; `pinned` is newest-first.
export function partitionPinnedRequests<
  T extends { action?: { kind: string } | null; sortAt: Date },
>(items: T[]): { pinned: T[]; rest: T[] } {
  const pinned: T[] = [];
  const rest: T[] = [];
  for (const item of items) {
    if (item.action?.kind === 'friend_request') pinned.push(item);
    else rest.push(item);
  }
  pinned.sort((a, b) => b.sortAt.getTime() - a.sortAt.getTime());
  return { pinned, rest };
}

export type LatelyBucket = {
  label: LatelyBucketLabel;
  items: LatelyMoment[];
};

export const THEY_GOT_YOU_CAPTIONS = [
  'THEY KNEW YOU',
  '{NAME} GOT IT',
  'THEY SAW IT',
  'A MATCH',
  'ON YOUR FREQUENCY',
] as const;

export const YOU_GOT_THEM_CAPTIONS = [
  'YOU KNEW THEM',
  'YOU SAW IT',
  'YOU NAILED IT',
  'A MATCH',
  'ON THEIR FREQUENCY',
] as const;

// Stable, dependency-free string hash used to spread copy-pool selection across
// events (the same event always draws the same line; a feed of the same event
// type still varies). Exported so the relationship copy pools in
// `activity-stream.ts` (D-FEED-GROUP3-01 Appendix A) select the same way.
export function djb2(input: string): number {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return hash >>> 0;
}

export function assignCaption(
  momentId: string,
  dir: LatelyDirection,
  friendFirstName: string,
): string {
  const pool =
    dir === 'they_got_you' ? THEY_GOT_YOU_CAPTIONS : YOU_GOT_THEM_CAPTIONS;
  const template = pool[djb2(momentId) % pool.length];
  return template.replace('{NAME}', friendFirstName.toUpperCase());
}

// Convergence (B-Convergence-1) headlines are PERSON-FIRST. They come in two
// pools (D-FEED-GROUP3-01 Pool 3): when the cluster's 3 questions share ONE
// topic, name it via the `{topic}` token (rendered in the serif category
// register); when the topics differ, fall back to the topic-less set rather
// than listing all three (listing reintroduces the wordiness we removed). Both
// carry the `{Name}` token, replaced with the friend's first name AT RENDER (as
// an actor link). Selection is deterministic by moment id (the same djb2
// mechanism the moments use). "you both" is accurate here only — convergence is
// the one mutual event.
//
// "have {topic} down cold" was removed (2026-09-06): it asserts standing
// mastery on the strength of three questions in one cluster, the same
// overclaim shape found and removed from activity-stream.ts's one-way pools
// (GOT_YOU_LINES / YOU_GOT_LINES). The other five lines here describe the
// event that happened; this was the only one asserting more than that.
export const CONVERGENCE_SINGLE_TOPIC = [
  'You and {Name} both know {topic} down',
  'You and {Name} both know {topic} inside out',
  'You and {Name} are right there together on {topic}',
  'You and {Name} both came through on {topic}',
  'Turns out you and {Name} both know {topic}',
] as const;

export const CONVERGENCE_NO_TOPIC = [
  'You and {Name} keep landing in the same place',
  'You and {Name} keep meeting in the same corners',
  'You and {Name} are on the same wavelength lately',
  'Turns out you and {Name} just get each other',
] as const;

// Pick a convergence headline template. `sharedTopic` non-null means all three
// cluster questions resolved to the SAME topic (detected at build time, where
// the domains are known); null means they differ (or weren't all resolvable),
// in which case we never name a topic.
export function convergenceCaptionTemplate(momentId: string, sharedTopic: string | null): string {
  if (sharedTopic) {
    return CONVERGENCE_SINGLE_TOPIC[djb2(momentId) % CONVERGENCE_SINGLE_TOPIC.length];
  }
  return CONVERGENCE_NO_TOPIC[djb2(momentId) % CONVERGENCE_NO_TOPIC.length];
}

function ymdInZone(date: Date, tz: string): string {
  // en-CA gives ISO-style YYYY-MM-DD reliably.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function bucketByDay<T>(
  items: T[],
  getDate: (item: T) => Date,
  tz: string,
  now: Date = new Date(),
): { label: LatelyBucketLabel; items: T[] }[] {
  const today = ymdInZone(now, tz);
  const yesterday = addDays(today, -1);
  const sevenAgo = addDays(today, -7);

  const todayItems: T[] = [];
  const yesterdayItems: T[] = [];
  const earlierItems: T[] = [];

  for (const item of items) {
    const ymd = ymdInZone(getDate(item), tz);
    if (ymd === today) todayItems.push(item);
    else if (ymd === yesterday) yesterdayItems.push(item);
    else if (ymd > sevenAgo && ymd < yesterday) earlierItems.push(item);
    // anything older than 7 days is dropped per spec
  }

  const buckets: { label: LatelyBucketLabel; items: T[] }[] = [];
  if (todayItems.length) buckets.push({ label: 'TODAY', items: todayItems });
  if (yesterdayItems.length) buckets.push({ label: 'YESTERDAY', items: yesterdayItems });
  if (earlierItems.length) buckets.push({ label: 'EARLIER THIS WEEK', items: earlierItems });
  return buckets;
}

export function bucketMoments(
  moments: LatelyMoment[],
  tz: string,
  now: Date = new Date(),
): LatelyBucket[] {
  return bucketByDay(moments, (m) => m.answeredAt, tz, now);
}

export function formatMomentTime(
  answeredAt: Date,
  bucket: LatelyBucketLabel,
  tz: string,
): string {
  if (bucket === 'EARLIER THIS WEEK') {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
    }).format(answeredAt).toUpperCase();
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hour: 'numeric',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(answeredAt);
    const hour = parts.find((p) => p.type === 'hour')?.value ?? '';
    const minute = parts.find((p) => p.type === 'minute')?.value ?? '';
    const unpaddedHour = String(parseInt(hour, 10));
    return `${weekday} ${unpaddedHour}:${minute}`;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(answeredAt);
}
