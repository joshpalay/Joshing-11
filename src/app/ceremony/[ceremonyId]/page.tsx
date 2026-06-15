'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Check, Share2, X } from 'lucide-react';

import { ShareCard } from '@/components/ShareCard';
import { getPortraitDomainColor } from '@/components/knowledge/PortraitCircles';
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy';
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
type Beat5 = {
  totalCreatorPoints: number;
  topQuestion: { text: string; answeredCount: number } | null;
};
type Beat6 = { domain: string; questionText: string; correctAnswer: string }[];
type Beat1FriendFallback = { friendName: string; count: number; domains: string[] };
type Beat5FriendFallback = { friendName: string; totalCreatorPoints: number };

type CeremonyMode = 'solo' | 'duo' | 'group';

type BeatsPayload = {
  cycleStart: string;
  cycleEnd: string;
  mode?: CeremonyMode;
  beat1: Beat1 | null;
  beat1FriendFallback?: Beat1FriendFallback | null;
  beat2: Beat2 | null;
  beat3: Beat3 | null;
  beat4: Beat4 | null;
  beat5: Beat5 | null;
  beat5FriendFallback?: Beat5FriendFallback | null;
  beat6?: Beat6 | null;
};

type CeremonyRow = {
  id: string;
  beatsPayload: BeatsPayload;
};

type BeatView =
  | { id: 1; content: Beat1 }
  | { id: '1-friend'; content: Beat1FriendFallback }
  | { id: 2; content: Beat2 }
  | { id: 3; content: Beat3 }
  | { id: 4; content: Beat4 }
  | { id: 5; content: Beat5 }
  | { id: '5-friend'; content: Beat5FriendFallback }
  | { id: 6; content: Beat6 };

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

type CeremonyCircleColor = {
  core: string;
  mid: string;
  rim: string;
  glow: string;
};

const CEREMONY_CIRCLE_COLORS: CeremonyCircleColor[] = [
  { core: '#ffe6a3', mid: '#f6b94a', rim: '#c96f1e', glow: '#f6b94a' },
  { core: '#c6f4ff', mid: '#56c7e8', rim: '#137ca7', glow: '#56c7e8' },
  { core: '#f0d0ff', mid: '#b675f0', rim: '#7143bc', glow: '#b675f0' },
  { core: '#c8ffd8', mid: '#5fd38a', rim: '#23865a', glow: '#5fd38a' },
  { core: '#ffd2df', mid: '#f06d94', rim: '#b72f62', glow: '#f06d94' },
  { core: '#d9e5ff', mid: '#779df2', rim: '#355cb8', glow: '#779df2' },
  { core: '#ffe2c3', mid: '#f29a4b', rim: '#b95b21', glow: '#f29a4b' },
  { core: '#d8fff8', mid: '#5bd4c5', rim: '#208a80', glow: '#5bd4c5' },
];

function ceremonyCircleColor(domain: string): CeremonyCircleColor {
  let hash = 0;
  for (let i = 0; i < domain.length; i += 1) {
    hash = ((hash << 5) - hash + domain.charCodeAt(i)) | 0;
  }
  return CEREMONY_CIRCLE_COLORS[Math.abs(hash) % CEREMONY_CIRCLE_COLORS.length]!;
}

function CeremonyCircle({
  domain,
  size = 72,
  scale = 1,
}: {
  domain: string;
  size?: number;
  scale?: number;
}) {
  const color = ceremonyCircleColor(domain);
  const fallbackColor = getPortraitDomainColor(domain);
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
          background: color.mid,
          border: `1px solid color-mix(in srgb, ${color.mid} 62%, ${fallbackColor.primary} 38%)`,
        }}
      />
    </span>
  );
}

function beatViews(payload: BeatsPayload): BeatView[] {
  const views: BeatView[] = [];
  if (payload.beat1) views.push({ id: 1, content: payload.beat1 });
  else if (payload.beat1FriendFallback)
    views.push({ id: '1-friend', content: payload.beat1FriendFallback });
  if (payload.beat2) views.push({ id: 2, content: payload.beat2 });
  if (payload.beat6) views.push({ id: 6, content: payload.beat6 });
  if (payload.beat3) views.push({ id: 3, content: payload.beat3 });
  if (payload.beat4) views.push({ id: 4, content: payload.beat4 });
  if (payload.beat5) views.push({ id: 5, content: payload.beat5 });
  else if (payload.beat5FriendFallback)
    views.push({ id: '5-friend', content: payload.beat5FriendFallback });
  return views;
}

function Beat({ beat, mode }: { beat: BeatView; mode?: CeremonyMode }) {
  if (beat.id === '1-friend') {
    const { friendName, count, domains } = beat.content;
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
          {friendName} leveled up this week.
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          You didn&rsquo;t cross a tier this week. {friendName} crossed {count} in{' '}
          {joinList(domains)}.
        </p>
      </div>
    );
  }

  if (beat.id === '5-friend') {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
          {beat.content.friendName} taught the room.
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          You didn&rsquo;t earn author credit this week. {beat.content.friendName}&rsquo;s questions
          earned {beat.content.totalCreatorPoints} points for others.
        </p>
      </div>
    );
  }

  if (beat.id === 1) {
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
          You leveled up.
        </h1>
        <div className="mx-auto mt-10 grid max-w-xl gap-4 text-left">
          {beat.content.map((crossing) => (
            <div key={`${crossing.domain}-${crossing.toTier}`} className="flex items-center gap-4">
              <CeremonyCircle
                domain={crossing.domain}
                size={74}
                scale={TIER_SCALE[crossing.toTier]}
              />
              <div>
                <p className="font-serif text-xl font-semibold text-stone-50">{crossing.domain}</p>
                <p className="mt-1 text-xs tracking-[0.16em] text-stone-400 uppercase">
                  {KNOWLEDGE_TIER_LABEL[crossing.fromTier]} {'->'}{' '}
                  {KNOWLEDGE_TIER_LABEL[crossing.toTier]}
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
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
              You went somewhere new.
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
              Through your friends, you picked up {friendTotal} {questionLabel(friendTotal)} in{' '}
              {joinList(friendMediated.map((item) => item.domain))}.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-5">
              {friendMediated.map((item) => (
                <div key={item.domain} className="flex flex-col items-center gap-3 text-center">
                  <CeremonyCircle
                    domain={item.domain}
                    size={88}
                    scale={Math.min(
                      1,
                      0.45 + (item.correctCount / Math.max(item.questionCount, 1)) * 0.45,
                    )}
                  />
                  <div>
                    <p className="font-serif text-base font-semibold text-stone-50">
                      {item.domain}
                    </p>
                    <p className="mt-1 text-xs tracking-[0.14em] text-stone-400 uppercase">
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
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
              You staked new territory.
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
              You wrote questions that opened{' '}
              {authored.length === 1 ? 'a new domain' : `${authored.length} new domains`}:{' '}
              {joinList(authored.map((item) => item.domain))}.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-5">
              {authored.map((item) => (
                <div key={item.domain} className="flex flex-col items-center gap-3 text-center">
                  <CeremonyCircle domain={item.domain} size={88} scale={0.35} />
                  <p className="font-serif text-base font-semibold text-stone-50">{item.domain}</p>
                  <p className="mt-1 text-xs tracking-[0.14em] text-stone-400 uppercase">
                    Declared
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
        {promoted.length > 0 && (
          <div>
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
              Your territory came to life.
            </h1>
            <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
              A friend answered your questions and proved your knowledge in{' '}
              {joinList(promoted.map((item) => item.domain))}.
            </p>
            <div className="mt-10 flex flex-wrap justify-center gap-5">
              {promoted.map((item) => (
                <div key={item.domain} className="flex flex-col items-center gap-3 text-center">
                  <CeremonyCircle domain={item.domain} size={88} scale={0.7} />
                  <p className="font-serif text-base font-semibold text-stone-50">{item.domain}</p>
                  <p className="mt-1 text-xs tracking-[0.14em] text-stone-400 uppercase">
                    Demonstrated
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (beat.id === 6) {
    return (
      <div className="mx-auto max-w-3xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
          Something you learned this week.
        </h1>
        <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
          You missed {beat.content.length === 1 ? 'this' : 'these'}, came back, and got{' '}
          {beat.content.length === 1 ? 'it' : 'them'} right.
        </p>
        <div className="mx-auto mt-10 grid max-w-2xl gap-5 text-left">
          {beat.content.map((item, index) => (
            <div key={`${item.domain}-${index}`} className="flex items-start gap-4">
              <CeremonyCircle domain={item.domain} size={56} scale={0.85} />
              <div className="min-w-0">
                <p className="font-serif text-lg leading-7 font-semibold text-stone-50">
                  {item.questionText}
                </p>
                <p className="mt-1 text-base text-stone-300">{item.correctAnswer}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (beat.id === 3) {
    const heading =
      mode === 'solo'
        ? 'Questions that shaped your cycle.'
        : 'These people gave you a chance to learn more.';
    return (
      <div className="mx-auto max-w-2xl text-center">
        <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">{heading}</h1>
        <div className="mt-10 space-y-4 text-lg text-stone-200 sm:text-xl">
          {beat.content.map((contributor) => (
            <p key={contributor.userId}>
              {contributor.displayName} contributed {contributor.contributionCount}{' '}
              {questionLabel(contributor.contributionCount)}.
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
      <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
        You taught people things.
      </h1>
      <p className="mx-auto mt-8 max-w-2xl text-lg leading-8 text-stone-200 sm:text-xl">
        Your questions earned {beat.content.totalCreatorPoints} points for others this week.
      </p>
      {beat.content.topQuestion ? (
        <p className="mx-auto mt-6 max-w-xl text-base leading-7 text-stone-300">
          Your most-played: &ldquo;{beat.content.topQuestion.text}&rdquo;
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
        if (!cancelled)
          setError(caught instanceof Error ? caught.message : 'Could not load this ceremony.');
      });

    fetch(`/api/ceremony/${ceremonyId}/viewed`, { method: 'POST', credentials: 'include' }).catch(
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [ceremonyId]);

  const beats = useMemo(() => (ceremony ? beatViews(ceremony.beatsPayload) : []), [ceremony]);
  const isEnd = currentIndex >= beats.length;

  function advance() {
    if (!ceremony || isEnd) return;
    setCurrentIndex((value) => Math.min(value + 1, beats.length));
  }

  function goBack() {
    setCurrentIndex((value) => Math.max(value - 1, 0));
  }

  function exit() {
    router.push('/');
  }

  // Story-style tap navigation: a tap on the left third steps back a beat, a
  // tap anywhere else advances. Buttons inside beats stopPropagation, so this
  // only fires on the backdrop.
  function handleTap(event: React.MouseEvent<HTMLElement>) {
    const width = event.currentTarget.clientWidth;
    if (width > 0 && event.clientX < width * 0.3) {
      goBack();
    } else {
      advance();
    }
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
        <p className="text-sm text-stone-300">Loading your week...</p>
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
        className="absolute top-[max(1.25rem,env(safe-area-inset-top))] right-5 z-20 grid size-11 place-items-center rounded-full text-stone-300 transition hover:bg-white/10 hover:text-stone-50"
        onClick={(event) => {
          event.stopPropagation();
          exit();
        }}
      >
        <X className="size-7" />
      </button>
      <div className="relative z-10 w-full">
        {isEnd ? (
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="font-serif text-5xl font-semibold tracking-normal sm:text-7xl">
              That&rsquo;s your week.
            </h1>
            <p className="mt-8 text-lg text-stone-200 sm:text-xl">See you next Sunday.</p>
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
                  router.push('/');
                }}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <Beat beat={beats[currentIndex]!} mode={ceremony.beatsPayload.mode} />
        )}
      </div>

      {shareUrl ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto bg-stone-950/80 px-5 py-8"
          role="dialog"
          aria-modal="true"
          aria-label="Share your week"
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
        <div
          className="absolute right-0 left-0 z-10 flex justify-center gap-2"
          style={{ bottom: 'max(1.75rem, env(safe-area-inset-bottom))' }}
        >
          {beats.map((beat, index) => (
            <span
              key={beat.id}
              className={
                index === currentIndex
                  ? 'h-2 w-8 rounded-full bg-stone-50'
                  : 'h-2 w-2 rounded-full bg-stone-500'
              }
            />
          ))}
        </div>
      ) : null}
    </main>
  );
}
