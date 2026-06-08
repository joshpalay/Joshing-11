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

function djb2(input: string): number {
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

// Convergence (B-Convergence-1) headlines are PERSON-FIRST and never name a
// domain — naming one of a mixed-domain cluster misrepresents the rest, and
// naming all reads as a stats list (a brand violation). Unlike the moment
// CAPTIONS above (all-caps chips), these are sentence-case one-liners: the
// `{Name}` token is replaced with the friend's first name AT RENDER (as an
// actor link), so the template is returned verbatim here. Assigned
// deterministically by moment id, the same djb2 mechanism the moments use.
export const CONVERGENCE_CAPTIONS = [
  'You and {Name} keep landing in the same place.',
  'Turns out you and {Name} think alike.',
  'You and {Name} are on the same wavelength lately.',
  'You and {Name} both knew these.',
  'You and {Name} just get each other.',
  'You and {Name} are clearly on the same page.',
] as const;

export function convergenceCaptionTemplate(momentId: string): string {
  return CONVERGENCE_CAPTIONS[djb2(momentId) % CONVERGENCE_CAPTIONS.length];
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
