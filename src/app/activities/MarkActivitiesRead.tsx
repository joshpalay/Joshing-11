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
      // reflects the just-written read/opened state. (The nav bell badge now
      // counts only pending friend requests, sourced from /api/nav — it is
      // unaffected by opening the bell and clears when a request is accepted
      // or declined.)
      router.refresh();
    });
  }, [router]);

  return null;
}
