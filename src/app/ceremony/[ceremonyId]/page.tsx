'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, Share2 } from 'lucide-react';

import { DomainCircle } from '@/components/knowledge/DomainCircle';
import type { MasteryTier } from '@/types/db';

type Beat1 = { domain: string; fromTier: MasteryTier; toTier: MasteryTier }[];
type Beat2 = { domain: string; questionCount: number; correctCount: number }[];
type Beat3 = { userId: string; displayName: string; contributionCount: number }[];
type Beat4 = { userId: string; displayName: string; sharedDomains: string[] };
type Beat5 = { totalCreatorPoints: number; topQuestion: { text: string; answeredCount: number } | null };

type BeatsPayload = {
  cycleStart: string;
  cycleEnd: string;
  beat1: Beat1 | null;
  beat2: Beat2 | null;
  beat3: Beat3 | null;
  beat4: Beat4 | null;
  beat5: Beat5 | null;
};

type CeremonyRow = {
  id: string;
  beatsPayload: BeatsPayload;
};

type BeatView =
  | { id: 1; content: Beat1 }
  | { id: 2; content: Beat2 }
  | { id: 3; content: Beat3 }
  | { id: 4; content: Beat4 }
  | { id: 5; content: Beat5 };

const TIER_LABEL: Record<MasteryTier, string> = {
  establishing: 'Establishing',
  familiar: 'Familiar',
  solid: 'Solid',
  mastery: 'Mastery',
};

function joinList(values: string[]) {
  if (values.length <= 2) return values.join(' and ');
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

function questionLabel(count: number) {
  return count === 1 ? 'question' : 'questions';
}

function beatViews(payload: BeatsPayload): BeatView[] {
  const views: BeatView[] = [];
  if (payload.beat1) views.push({ id: 1, content: payload.beat1 });
  if (payload.beat2) views.push({ id: 2, content: payload.beat2 });
  if (payload.beat3) views.push({ id: 3, content: payload.beat3 });
  if (payload.beat4) views.push({ id: 4, content: payload.beat4 });
  if (payload.beat5) views.push({ id: 5, content: payload.beat5 });
  return views;
}

function Beat({ beat }: { beat: BeatView }) {
  if (beat.id === 1) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">You leveled up.</h1>
        <div className="mt-10 space-y-4 text-lg text-stone-200 sm:text-xl">
          {beat.content.map((crossing) => (
            <p key={`${crossing.domain}-${crossing.toTier}`}>
              {crossing.domain}: {TIER_LABEL[crossing.fromTier]} {'->'} {TIER_LABEL[crossing.toTier]}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (beat.id === 2) {
    const total = beat.content.reduce((sum, item) => sum + item.questionCount, 0);
    const domains = beat.content.map((item) => item.domain);
    return (
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">You went somewhere new.</h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          Through your friends, you picked up {total} {questionLabel(total)} in {joinList(domains)}.
        </p>
        <div className="mt-10 flex flex-wrap justify-center gap-5">
          {domains.map((domain) => (
            <DomainCircle
              key={domain}
              diameter={82}
              iconKey={domain}
              canonicalSubcategory={domain}
              currentTier={null}
              highlighted
              showTierLabel={false}
            />
          ))}
        </div>
      </div>
    );
  }

  if (beat.id === 3) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">These people taught you something.</h1>
        <div className="mt-10 space-y-4 text-lg text-stone-200 sm:text-xl">
          {beat.content.map((contributor) => (
            <p key={contributor.userId}>
              {contributor.displayName} contributed {contributor.contributionCount} {questionLabel(contributor.contributionCount)}.
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (beat.id === 4) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
          You and {beat.content.displayName} see the world similarly.
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          You both know {joinList(beat.content.sharedDomains)}.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl text-center">
      <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">You taught people things.</h1>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
        Your questions earned {beat.content.totalCreatorPoints} points for others this fortnight.
      </p>
      {beat.content.topQuestion ? (
        <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-stone-300">
          Your most-played: "{beat.content.topQuestion.text}"
        </p>
      ) : null}
    </div>
  );
}

export default function CeremonyPage() {
  const router = useRouter();
  const params = useParams<{ ceremonyId: string }>();
  const ceremonyId = params.ceremonyId;
  const [ceremony, setCeremony] = useState<CeremonyRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/ceremony/${ceremonyId}`, { cache: 'no-store', credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.message ?? 'Could not load this ceremony.');
        if (!cancelled) setCeremony(body.ceremony);
      })
      .catch((caught) => {
        if (!cancelled) setError(caught instanceof Error ? caught.message : 'Could not load this ceremony.');
      });

    fetch(`/api/ceremony/${ceremonyId}/viewed`, { method: 'POST', credentials: 'include' }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [ceremonyId]);

  const beats = useMemo(() => ceremony ? beatViews(ceremony.beatsPayload) : [], [ceremony]);
  const isEnd = currentIndex >= beats.length;

  function advance() {
    if (!ceremony || isEnd) return;
    setCurrentIndex((value) => Math.min(value + 1, beats.length));
  }

  async function share(event: React.MouseEvent<HTMLButtonElement>) {
    event.stopPropagation();
    const origin = window.location.origin;
    await navigator.clipboard.writeText(`${origin}/ceremony/${ceremonyId}`);
    setCopied(true);
  }

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 px-6 text-center text-stone-100">
        <p className="text-sm text-stone-300">{error}</p>
      </main>
    );
  }

  if (!ceremony) {
    return (
      <main className="grid min-h-dvh place-items-center bg-stone-950 px-6 text-center text-stone-100">
        <p className="text-sm text-stone-300">Loading your two weeks...</p>
      </main>
    );
  }

  return (
    <main
      className="relative grid min-h-dvh cursor-pointer place-items-center overflow-hidden bg-stone-950 px-6 py-16 text-stone-50"
      onClick={advance}
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(245,240,232,0.12),transparent_36%),linear-gradient(180deg,#1c1917_0%,#0c0a09_100%)]" />
      <div className="relative z-10 w-full">
        {isEnd ? (
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">That's your two weeks.</h1>
            <p className="mt-8 text-lg text-stone-200 sm:text-xl">See you in another fourteen days.</p>
            <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-stone-500 px-5 text-sm text-stone-50"
                onClick={share}
              >
                {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
                {copied ? 'Copied' : 'Share'}
              </button>
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-5 text-sm font-medium text-stone-950"
                onClick={(event) => {
                  event.stopPropagation();
                  router.push('/feed');
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <Beat beat={beats[currentIndex]!} />
        )}
      </div>

      {!isEnd && beats.length > 0 ? (
        <div className="absolute bottom-7 left-0 right-0 z-10 flex justify-center gap-2">
          {beats.map((beat, index) => (
            <span
              key={beat.id}
              className={index === currentIndex ? 'h-2 w-8 rounded-full bg-stone-50' : 'h-2 w-2 rounded-full bg-stone-500'}
            />
          ))}
        </div>
      ) : null}
    </main>
  );
}
