import Link from 'next/link';
import { notFound } from 'next/navigation';

import { ShareCard } from '@/components/ShareCard';
import type { ShareCardBeatsPayload } from '@/components/ShareCard';

// Public share URLs are immutable per token in the steady state — the only
// way a payload changes is a manual ceremony re-fire, which is rare. Cache
// for an hour so social/SMS previews and link-clicks don't repeatedly hit
// the API. Stale 1-hour content is acceptable for this surface.
export const revalidate = 3600;

type ShareCardResponse = {
  userName: string;
  cycleStart: string;
  cycleEnd: string;
  beatsPayload: ShareCardBeatsPayload;
};

function baseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

async function getShareCard(token: string): Promise<ShareCardResponse | null> {
  const response = await fetch(`${baseUrl()}/api/share/ceremony/${token}`, {
    next: { revalidate: 3600 },
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not load share card.');
  return response.json();
}

export default async function CeremonySharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await getShareCard(token);

  if (!data) notFound();

  return (
    // The app has ONE ground and it is cream (Josh, 2026-09-17: no dark mode).
    // This page used to paint a raw `bg-stone-950` backdrop, which was never a
    // theme — just an unconverted default. It also fought the thing it exists to
    // show: <ShareCard> is a LIGHT card (a PAPER→CREAM gradient on warm ink).
    <main className="min-h-dvh bg-[var(--brand-cream-page)] px-5 py-10 text-[var(--brand-ink)]">
      <div className="mx-auto flex max-w-md flex-col items-center gap-7">
        <ShareCard
          beatsPayload={data.beatsPayload}
          userName={data.userName}
          cycleStart={data.cycleStart}
          cycleEnd={data.cycleEnd}
        />

        <section className="w-full space-y-4 text-center">
          <details className="rounded-[var(--radius-card)] border border-[var(--brand-border)] bg-[var(--brand-card)] px-4 py-3 text-left">
            <summary className="min-h-11 cursor-pointer text-sm font-medium text-[var(--brand-ink)]">
              What&rsquo;s this?
            </summary>
            <p className="mt-3 text-sm leading-6 text-[var(--brand-ink-700)]">
              Joshing is a private knowledge game with friends. Every week, it turns what you learned,
              wrote, and shared into a small reflection.
            </p>
          </details>

          {/* Was a hand-rolled `h-12 rounded-md bg-stone-100` button. It is the
              one CTA on the page a stranger lands on, so it is .btn-primary —
              which also brings it to the §9.1 floor and the 4px corner. */}
          <Link href="/login" className="btn-primary">
            Try Joshing
          </Link>
        </section>
      </div>
    </main>
  );
}
