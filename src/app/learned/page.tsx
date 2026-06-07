'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';

type LearnedItem = {
  questionId: string;
  questionText: string;
  correctAnswer: string;
  domain: string;
  domainDisplayName: string;
  learnedAt: string;
};

function DomainHalo({ domain, size = 96 }: { domain: string; size?: number }) {
  const color = getPortraitDomainColor(domain);
  return (
    <span
      aria-hidden
      className="mx-auto block rounded-full"
      style={{
        width: size,
        height: size,
        background: `radial-gradient(circle at 38% 38%, ${color.light.replace('0.12', '0.32')}, ${color.light})`,
        border: `1px solid ${color.primary}55`,
      }}
    />
  );
}

// The intro is its own "beat" so the title gets a full screen before the first
// question, mirroring the biweekly ceremony's story pacing.
function IntroBeat({ count }: { count: number }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <p className="text-xs uppercase tracking-[0.22em] text-stone-400">This week</p>
      <h1 className="mt-6 font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
        Something you learned this week.
      </h1>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
        {count === 1
          ? 'You missed a question, came back, and got it right.'
          : `You missed ${count} questions, came back, and got them right.`}
      </p>
    </div>
  );
}

function QuestionBeat({ item, index, total }: { item: LearnedItem; index: number; total: number }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <DomainHalo domain={item.domain} />
      <p className="mt-6 text-xs uppercase tracking-[0.18em] text-stone-400">
        {item.domainDisplayName} · {index + 1} of {total}
      </p>
      <h1 className="mx-auto mt-6 max-w-2xl font-serif text-3xl font-semibold leading-tight tracking-normal sm:text-4xl">
        {item.questionText}
      </h1>
      <p className="mt-10 text-xs uppercase tracking-[0.22em] text-stone-400">You missed it. Now you know:</p>
      <p className="mx-auto mt-4 max-w-xl font-serif text-2xl font-semibold text-stone-50 sm:text-3xl">
        {item.correctAnswer}
      </p>
    </div>
  );
}

export default function LearnedThisWeekPage() {
  const router = useRouter();
  const [items, setItems] = useState<LearnedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/learned', { cache: 'no-store', credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.message ?? 'Could not load this week.');
        if (!cancelled) setItems(body.items ?? []);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load this week.');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Beats = intro + one per question. The end screen lives past the last beat,
  // same as the biweekly ceremony.
  const beatCount = useMemo(() => (items && items.length > 0 ? items.length + 1 : 0), [items]);
  const isEnd = beatCount > 0 && currentIndex >= beatCount;

  function advance() {
    if (!items || isEnd) return;
    setCurrentIndex((value) => Math.min(value + 1, beatCount));
  }

  function goBack() {
    setCurrentIndex((value) => Math.max(value - 1, 0));
  }

  // Story-style tap navigation: a tap on the left third steps back, anywhere
  // else advances. Buttons stopPropagation so this only fires on the backdrop.
  function handleTap(event: React.MouseEvent<HTMLElement>) {
    const width = event.currentTarget.clientWidth;
    if (width > 0 && event.clientX < width * 0.3) {
      goBack();
    } else {
      advance();
    }
  }

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 px-6 text-center text-stone-100">
        <p className="text-sm text-stone-300">{error}</p>
      </main>
    );
  }

  if (!items) {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 px-6 text-center text-stone-100">
        <p className="text-sm text-stone-300">Loading your week...</p>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 px-6 text-center text-stone-100">
        <div className="mx-auto max-w-md">
          <h1 className="font-serif text-3xl font-semibold tracking-normal">Nothing turned around yet.</h1>
          <p className="mt-6 text-sm leading-7 text-stone-300">
            When you miss a question and later get it right, it shows up here as something you learned.
          </p>
          <button
            type="button"
            className="mt-8 inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-5 text-sm font-medium text-stone-950"
            onClick={() => router.push('/')}
          >
            Back home
          </button>
        </div>
      </main>
    );
  }

  return (
    <main
      className="relative grid min-h-dvh cursor-pointer place-items-center overflow-hidden bg-stone-950 px-6 py-16 text-stone-50"
      onClick={handleTap}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(245,240,232,0.12),transparent_36%),linear-gradient(180deg,#1c1917_0%,#0c0a09_100%)]" />

      <button
        type="button"
        aria-label="Exit"
        className="absolute right-5 top-[max(1.25rem,env(safe-area-inset-top))] z-20 grid size-11 place-items-center rounded-full text-stone-300 transition hover:bg-white/10 hover:text-stone-50"
        onClick={(event) => {
          event.stopPropagation();
          router.push('/');
        }}
      >
        <X className="size-7" />
      </button>

      <div className="relative z-10 w-full">
        {isEnd ? (
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">That stuck.</h1>
            <p className="mt-8 text-lg text-stone-200 sm:text-xl">
              {items.length === 1 ? "That's one thing you'll keep." : `That's ${items.length} things you'll keep.`}
            </p>
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-5 text-sm font-medium text-stone-950"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push('/');
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : currentIndex === 0 ? (
          <IntroBeat count={items.length} />
        ) : (
          <QuestionBeat item={items[currentIndex - 1]!} index={currentIndex - 1} total={items.length} />
        )}
      </div>

      {!isEnd ? (
        <div
          className="absolute left-0 right-0 z-10 flex justify-center gap-2"
          style={{ bottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}
        >
          {Array.from({ length: beatCount }).map((_, index) => (
            <span
              key={index}
              className={index === currentIndex ? 'h-2 w-8 rounded-full bg-stone-50' : 'h-2 w-2 rounded-full bg-stone-500'}
            />
          ))}
        </div>
      ) : null}
    </main>
  );
}
