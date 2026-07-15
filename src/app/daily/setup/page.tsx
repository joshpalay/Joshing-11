import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

// The Configure page retired into the knowledge portrait (Josh, 2026-07-14):
// rotation lives in the portrait's Frequency view + detail pop-up, adding in
// the "Add a territory" block, and removal in the pop-up's remove link. This
// stub keeps every old /daily/setup URL (emails, bookmarks, stale clients)
// landing somewhere sensible. TerritorySetupClient stays on disk, unrouted.
export default function DailySetupPage() {
  redirect('/knowledge');
}
