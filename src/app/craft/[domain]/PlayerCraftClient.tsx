'use client';

import { useRouter } from 'next/navigation';

import { CreationSurface } from '@/components/craft/CreationSurface';

export function PlayerCraftClient({ domain }: { domain: string }) {
  const router = useRouter();
  return (
    <main className="mx-auto min-h-dvh max-w-3xl px-4 py-6">
      <CreationSurface
        domain={domain}
        statsLine={null}
        endpoint="/api/craft"
        variant="player"
        onBack={() => router.back()}
      />
    </main>
  );
}
