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
      // Refresh the server components on this route so the activity list
      // reflects the just-written read/opened state. Opening Lately also
      // advances lastActivityBellOpenedAt (via /api/activities/opened), which
      // is the floor getBellBadgeCount uses — so the nav bell badge clears once
      // /api/nav refetches.
      router.refresh();
    });
  }, [router]);

  return null;
}
