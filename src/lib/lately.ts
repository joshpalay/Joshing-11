import type { LatelyDirection, LatelyMoment } from '@/server/db/queries/lately';

export type LatelyBucketLabel = 'TODAY' | 'YESTERDAY' | 'EARLIER THIS WEEK';

export type LatelyBucket = {
  label: LatelyBucketLabel;
  items: LatelyMoment[];
};

export const SHARED_CAPTIONS = [
  'SHARED FREQUENCY',
  'BOTH OF YOU',
  'COMMON GROUND',
  'A MATCH',
  'ON THE SAME WAVELENGTH',
  'TWO MINDS, ONE ANSWER',
  'A SHARED CORNER',
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
  _dir: LatelyDirection,
  _friendFirstName: string,
): string {
  return SHARED_CAPTIONS[djb2(momentId) % SHARED_CAPTIONS.length];
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

export function bucketMoments(
  moments: LatelyMoment[],
  tz: string,
  now: Date = new Date(),
): LatelyBucket[] {
  const today = ymdInZone(now, tz);
  const yesterday = addDays(today, -1);
  const sevenAgo = addDays(today, -7);

  const todayItems: LatelyMoment[] = [];
  const yesterdayItems: LatelyMoment[] = [];
  const earlierItems: LatelyMoment[] = [];

  for (const m of moments) {
    const ymd = ymdInZone(m.answeredAt, tz);
    if (ymd === today) todayItems.push(m);
    else if (ymd === yesterday) yesterdayItems.push(m);
    else if (ymd > sevenAgo && ymd < yesterday) earlierItems.push(m);
    // anything older than 7 days is dropped per spec
  }

  const buckets: LatelyBucket[] = [];
  if (todayItems.length) buckets.push({ label: 'TODAY', items: todayItems });
  if (yesterdayItems.length) buckets.push({ label: 'YESTERDAY', items: yesterdayItems });
  if (earlierItems.length) buckets.push({ label: 'EARLIER THIS WEEK', items: earlierItems });
  return buckets;
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
