'use client';

export const dynamic = 'force-dynamic';

import { Suspense } from 'react';

import { TerritorySetupClient } from './TerritorySetupClient';

export default function DailySetupPage() {
  return (
    <Suspense>
      <TerritorySetupClient />
    </Suspense>
  );
}
