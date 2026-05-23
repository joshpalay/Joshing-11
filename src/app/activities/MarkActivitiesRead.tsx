'use client';

import { useEffect } from 'react';

export function MarkActivitiesRead() {
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
    ]);
  }, []);

  return null;
}
