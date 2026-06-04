'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export function MarkActivitiesRead() {
  const router = useRouter();

  useEffect(() => {
    void Promise.allSettled([
      fetch('/api/activities/read', {
        method: 'POST',
        credentials: 'include',
      }),
      fetch('/api/activities/opened', {
        method: 'POST',
        credentials: 'include',
      }),
    ]).then(() => {
      // The bell badge count is computed server-side in the root layout
      // (getBellBadgeCount in layout.tsx) and passed into Nav as a prop. The
      // root layout is preserved across navigations and does not re-run after
      // these POSTs, so without an explicit refresh the badge keeps showing
      // the stale pre-open count until the next hard render. Refresh re-runs
      // the server layout so the badge clears in place.
      router.refresh();
    });
  }, [router]);

  return null;
}
