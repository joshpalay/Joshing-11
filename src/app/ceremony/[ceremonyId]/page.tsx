'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, Share2, X } from 'lucide-react';

import { ShareCard } from '@/components/ShareCard';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import type { MasteryTier } from '@/types/db';

type Beat1 = { domain: string; fromTier: MasteryTier; toTier: MasteryTier }[];
type Beat2FriendItem = { domain: string; questionCount: number; correctCount: number };
type Beat2 = {
  friendMediated: Beat2FriendItem[];
  authored: { domain: string }[];
  promoted: { domain: string }[];
};
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

const TIER_SCALE: Record<MasteryTier, number> = {
  establishing: 0.28,
  familiar: 0.48,
  solid: 0.72,
  mastery: 1,
};

function CeremonyCircle({
  domain,
  size = 72,
  scale = 1,
}: {
  domain: string;
  size?: number;
  scale?: number;
}) {
  const color = getPortraitDomainColor(domain);
  const circleSize = Math.round(size * scale);
  return (
    <span
      aria-hidden
      className="inline-grid shrink-0 place-items-center"
      style={{ width: size, height: size }}
    >
      <span
        className="block rounded-full"
        style={{
          width: circleSize,
          height: circleSize,
          background: `radial-gradient(circle at 38% 38%, ${color.light.replace('0.12', '0.3')}, ${color.light})`,
          border: `1px solid ${color.primary}55`,
        }}
      />
    </span>
  );
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
        <div className="mx-auto mt-10 grid max-w-xl gap-4 text-left">
          {beat.content.map((crossing) => (
            <div key={`${crossing.domain}-${crossing.toTier}`} className="flex items-center gap-4">
              <CeremonyCircle domain={crossing.domain} size={74} scale={TIER_SCALE[crossing.toTier]} />
              <div>
                <p className="font-serif text-xl font-semibold text-stone-50">{crossing.domain}</p>
                <p className="mt-1 text-xs uppercase tracking-[0.16em] text-stone-400">
                  {TIER_LABEL[crossing.fromTier]} {'->'} {TIER_LABEL[crossing.toTier]}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (beat.id === 2) {
    const { friendMediated, authored, promoted } = beat.content;
    const friendTotal = friendMediated.reduce((sum, item) => sum + item.questionCount, 0);
    return (
      <div className="mx-auto max-w-3xl space-y-16 text-center">
        {friendMediated.length > 0 && (
          <div>
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">You went somewhere new.</h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
              Through your friends, you picked up {friendTotal} {questionLabel(friendTotal)} in {joinList(friendMediated.map((item) => item.domain))}.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-5">
              {friendMediated.map((item) => (
                <div key={item.domain} className="flex flex-col items-center gap-3 text-center">
                  <CeremonyCircle domain={item.domain} size={88} scale={Math.min(1, 0.45 + item.correctCount / Math.max(item.questionCount, 1) * 0.45)} />
                  <div>
                    <p className="font-serif text-base font-semibold text-stone-50">{item.domain}</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.14em] text-stone-400">
                      {item.correctCount}/{item.questionCount}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {authored.length > 0 && (
          <div>
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">You staked new territory.</h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
              You wrote questions that opened {authored.length === 1 ? 'a new domain' : `${authored.length} new domains`}: {joinList(authored.map((item) => item.domain))}.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-5">
              {authored.map((item) => (
                <div key={item.domain} className="flex flex-col items-center gap-3 text-center">
                  <CeremonyCircle domain={item.domain} size={88} scale={0.35} />
                  <p className="font-serif text-base font-semibold text-stone-50">{item.domain}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-stone-400">Declared</p>
                </div>
              ))}
            </div>
          </div>
        )}
        {promoted.length > 0 && (
          <div>
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">Your territory came to life.</h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
              A friend answered your questions and proved your knowledge in {joinList(promoted.map((item) => item.domain))}.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-5">
              {promoted.map((item) => (
                <div key={item.domain} className="flex flex-col items-center gap-3 text-center">
                  <CeremonyCircle domain={item.domain} size={88} scale={0.7} />
                  <p className="font-serif text-base font-semibold text-stone-50">{item.domain}</p>
                  <p className="mt-1 text-xs uppercase tracking-[0.14em] text-stone-400">Demonstrated</p>
                </div>
              ))}
            </div>
          </div>
        )}
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
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [shareLoading, setShareLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(null), 2200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

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
    setShareLoading(true);
    try {
      const response = await fetch(`/api/ceremony/${ceremonyId}/share-token`, {
        method: 'POST',
        credentials: 'include',
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? 'Could not create share link.');
      setShareUrl(body.url);
    } catch (caught) {
      setToast(caught instanceof Error ? caught.message : 'Could not create share link.');
    } finally {
      setShareLoading(false);
    }
  }

  async function copyShareUrl() {
    if (!shareUrl) return;
    await navigator.clipboard.writeText(shareUrl);
    setToast('Link copied');
  }

  function saveImageHint() {
    setToast('Long-press the card to save it.');
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
                disabled={shareLoading}
              >
                <Share2 className="size-4" />
                {shareLoading ? 'Opening...' : 'Share'}
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

      {shareUrl ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-stone-950/80 px-5 py-8"
          role="dialog"
          aria-modal="true"
          aria-label="Share your two weeks"
          onClick={(event) => {
            event.stopPropagation();
            if (event.target === event.currentTarget) setShareUrl(null);
          }}
        >
          <div className="flex w-full max-w-md flex-col items-center gap-5">
            <ShareCard
              beatsPayload={ceremony.beatsPayload}
              userName="You"
              cycleStart={ceremony.beatsPayload.cycleStart}
              cycleEnd={ceremony.beatsPayload.cycleEnd}
            />

            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-stone-100 px-4 text-sm font-medium text-stone-950"
                onClick={(event) => {
                  event.stopPropagation();
                  copyShareUrl().catch(() => setToast('Could not copy link.'));
                }}
              >
                <Check className="size-4" />
                Copy link
              </button>
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center rounded-md border border-stone-500 px-4 text-sm text-stone-50"
                onClick={(event) => {
                  event.stopPropagation();
                  saveImageHint();
                }}
              >
                Save image
              </button>
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-stone-500 px-4 text-sm text-stone-50"
                onClick={(event) => {
                  event.stopPropagation();
                  setShareUrl(null);
                }}
              >
                <X className="size-4" />
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-stone-100 px-4 py-2 text-sm font-medium text-stone-950 shadow-lg">
          {toast}
        </div>
      ) : null}

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
