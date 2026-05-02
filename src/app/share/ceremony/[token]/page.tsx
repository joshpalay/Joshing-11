import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ShareCard } from '@/components/ShareCard';
import type { BeatsPayload } from '@/server/ceremony/compute-beats';

type ShareCardResponse = {
  userName: string;
  cycleStart: string;
  cycleEnd: string;
  beatsPayload: BeatsPayload;
};

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

async function getShareCard(token: string): Promise<ShareCardResponse | null> {
  const response = await fetch(`${baseUrl()}/api/share/ceremony/${token}`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not load share card.');
  return response.json();
}

export default async function CeremonySharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getShareCard(token);

  if (!data) notFound();

  return (
    <main className="min-h-dvh bg-stone-950 px-5 py-10 text-stone-50">
      <div className="mx-auto flex max-w-md flex-col items-center gap-7">
        <ShareCard
          beatsPayload={data.beatsPayload}
          userName={data.userName}
          cycleStart={data.cycleStart}
          cycleEnd={data.cycleEnd}
        />

        <section className="w-full space-y-4 text-center">
          <details className="rounded-md border border-stone-700 bg-stone-900/70 px-4 py-3 text-left">
            <summary className="cursor-pointer text-sm font-medium text-stone-100">What's this?</summary>
            <p className="mt-3 text-sm leading-6 text-stone-300">
              Joshing is a private knowledge game with friends. Every two weeks, it turns what you learned,
              wrote, and shared into a small reflection.
            </p>
          </details>

          <Link
            href="/login"
            className="inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-6 text-sm font-medium text-stone-950"
          >
            Try Joshing
          </Link>
        </section>
      </div>
    </main>
  );
}
