import { Suspense } from 'react';

import TriangleBackground from '@/components/TriangleBackground';

import LoginPanel from './LoginPanel';

function TitleCard() {
  return (
    <section className="w-full max-w-sm rounded-2xl bg-[var(--brand-cream-card)] px-8 py-7 text-center shadow-[0_8px_24px_rgba(20,18,8,0.18)] ring-1 ring-black/5">
      <h1 className="font-sans text-4xl font-extrabold tracking-[0.06em] text-[var(--brand-navy)]">
        JOSHING
      </h1>
      <div className="mx-auto mt-4 h-0.5 w-14 rounded-full bg-[var(--brand-navy)]/40" aria-hidden="true" />
      <p className="mt-4 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand-navy)]/80">
        Trivia you wish you were asked
      </p>
    </section>
  );
}

export default function LoginPage() {
  return (
    <TriangleBackground>
      <main className="relative z-10 flex min-h-screen flex-col items-center justify-start gap-5 px-6 pt-14 pb-10">
        <TitleCard />
        <Suspense
          fallback={
            <div className="h-72 w-full max-w-sm rounded-2xl bg-[var(--brand-cream-card)] shadow-[0_8px_24px_rgba(20,18,8,0.18)] ring-1 ring-black/5" />
          }
        >
          <LoginPanel />
        </Suspense>
      </main>
    </TriangleBackground>
  );
}
