import { Suspense } from 'react';

import TriangleBackground from '@/components/TriangleBackground';

import LoginPanel from './LoginPanel';

function TitleCard() {
  return (
    <section className="w-full max-w-sm rounded-[8px] bg-[var(--brand-cream-card)] px-[46px] py-7 text-center shadow-[0_4px_4px_0_rgba(0,0,0,0.25),0_4px_12px_0_rgba(40,32,30,0.04)] ring-1 ring-black/5">
      <h1 className="font-sans text-[48px] leading-[52px] font-bold tracking-[4.8px] text-[var(--brand-ink-950)]">
        JOSHING
      </h1>
      <div
        className="mx-auto mt-4 h-0.5 w-[60px] rounded-full bg-[var(--tri-amber)]"
        aria-hidden="true"
      />
      <p className="font-inter mt-4 text-center text-[18px] leading-6 font-normal tracking-[3.6px] text-black uppercase">
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
            <div className="h-72 w-full max-w-sm rounded-2xl bg-[var(--brand-cream-card)] shadow-[0_4px_4px_0_rgba(0,0,0,0.25),0_4px_12px_0_rgba(40,32,30,0.04)] ring-1 ring-black/5" />
          }
        >
          <LoginPanel />
        </Suspense>
      </main>
    </TriangleBackground>
  );
}
