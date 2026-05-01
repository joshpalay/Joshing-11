'use client';

import { useEffect } from 'react';

export function MarkActivitiesRead() {
  useEffect(() => {
    void fetch('/api/activities/read', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => undefined);
  }, []);

  return null;
}
