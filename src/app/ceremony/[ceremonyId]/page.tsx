'use client';

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Share2, X } from 'lucide-react';

import { ShareCard } from '@/components/ShareCard';
import { usePrefersReducedMotion } from '@/components/feed/usePrefersReducedMotion';
import { KNOWLEDGE_TIER_LABEL } from '@/server/profile/knowledge-tier-copy';
import type { MasteryTier } from '@/types/db';

// ─────────────────────────────────────────────────────────────────────────────
// JOSHING — Weekly Ceremony (solo reflection), bold full-bleed redesign.
// Each beat is its own saturated, full-bleed "room"; type reverses to light on
// color. Ink-on-cream is broken on purpose. One staggered reveal per room, tap
// to advance (tap the left third to step back). Colors come from the
// --ceremony-* token ramp in globals.css — no inline hex. Cadence is WEEKLY.
//
// Rooms (silently omitted when their beat is empty; opener + closer always
// present so the story never collapses to one screen):
//   opener · mastered (or friend-fallback) · discovered · learned (beat6) ·
//   shaped · alignment · gave (or friend-fallback) · closer
// ─────────────────────────────────────────────────────────────────────────────

type CeremonyMode = 'solo' | 'duo' | 'group';

type Opener = { weekIndex: number; questionsRight: number; sessionsPlayed: number };
type Beat1 = { domain: string; fromTier: MasteryTier; toTier: MasteryTier }[];
type Beat2Item = { domain: string; questionCount: number; correctCount: number; via?: string | null };
type Beat2 = { friendMediated: Beat2Item[]; authored: { domain: string }[]; promoted: { domain: string }[] };
type Beat3 = { userId: string; displayName: string; contributionCount: number }[];
type Beat4 = { userId: string; displayName: string; sharedDomains: string[] };
type Beat5 = {
  totalCreatorPoints: number;
  totalAnswered?: number;
  topQuestion: { text: string; answeredCount: number } | null;
};
type Beat6 = { domain: string; questionText: string; correctAnswer: string }[];
type Beat1FriendFallback = { friendName: string; count: number; domains: string[] };
type Beat5FriendFallback = { friendName: string; totalCreatorPoints: number };

type BeatsPayload = {
  cycleStart: string;
  cycleEnd: string;
  opener?: Opener | null;
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

type CeremonyRow = { id: string; beatsPayload: BeatsPayload };

// ── Fonts (loaded app-wide via next/font; reference the tokens) ──────────────
const SERIF = 'var(--font-serif)';
const SANS = 'var(--font-sans)';
const MONO = 'var(--font-mono)';

// ── Per-room theme (token-backed) ───────────────────────────────────────────
type RoomTheme = { bg: string; fg: string; accent: string; sub: string };
function roomTheme(name: string): RoomTheme {
  return {
    bg: `var(--ceremony-${name}-bg)`,
    fg: `var(--ceremony-${name}-fg)`,
    accent: `var(--ceremony-${name}-accent)`,
    sub: `var(--ceremony-${name}-sub)`,
  };
}
const TH = {
  open: roomTheme('open'),
  mastered: roomTheme('mastered'),
  discovered: roomTheme('discovered'),
  learned: roomTheme('learned'),
  shaped: roomTheme('shaped'),
  alignment: roomTheme('alignment'),
  gave: roomTheme('gave'),
  close: roomTheme('close'),
};

// ── Motion helpers (reduced-motion aware) ────────────────────────────────────
// Both hooks only ever call setState inside an async callback (rAF / interval),
// never synchronously in the effect body — the reduced-motion and inactive
// cases are derived at return time instead (react-hooks/set-state-in-effect).

// Eased count-up. Returns the target immediately under reduced motion.
function useCountUp(target: number, run: boolean, reduced: boolean, ms = 1000): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run || reduced) return;
    let raf = 0;
    let start = 0;
    const tick = (t: number) => {
      if (!start) start = t;
      const p = Math.min((t - start) / ms, 1);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run, target, ms, reduced]);
  if (!run) return 0;
  if (reduced) return target;
  return n;
}

// Incrementing step while a room is active; gates the staggered reveal. Each
// room mounts fresh (only the current room renders), so the ticker starts at 0
// on mount. Under reduced motion every step is revealed at once.
function useTicker(active: boolean, reduced: boolean, ms = 950): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!active || reduced) return;
    const id = window.setInterval(() => setT((x) => x + 1), ms);
    return () => window.clearInterval(id);
  }, [active, ms, reduced]);
  if (!active) return 0;
  if (reduced) return 99;
  return t;
}

function Reveal({
  show,
  delay = 0,
  reduced,
  children,
  style,
}: {
  show: boolean;
  delay?: number;
  reduced: boolean;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        opacity: show ? 1 : 0,
        transform: show ? 'translateY(0)' : 'translateY(16px)',
        transition: reduced
          ? 'none'
          : `opacity .65s ease ${delay}s, transform .65s cubic-bezier(.2,.7,.2,1) ${delay}s`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children, color }: { children: ReactNode; color: string }) {
  return (
    <div
      style={{
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: 4,
        textTransform: 'uppercase',
        color,
        marginBottom: 20,
      }}
    >
      {children}
    </div>
  );
}

function Shell({ th, children }: { th: RoomTheme; children: ReactNode }) {
  // A room centers its content when it fits, but a tall beat (long question
  // text, a long domain list) can exceed the viewport. `justify-content: center`
  // would clip the overflow off both edges with no way to read it, so instead we
  // let the room scroll and center via auto margins on the child — auto margins
  // collapse to 0 when content overflows, keeping the top reachable rather than
  // clipped. Extra top/bottom padding clears the pips and the "tap to continue"
  // hint. Vertical drags scroll; a tap still advances (handled on <main>).
  return (
    <div
      className="ceremony-room-in"
      style={{
        position: 'absolute',
        inset: 0,
        background: th.bg,
        display: 'flex',
        flexDirection: 'column',
        overflowY: 'auto',
        WebkitOverflowScrolling: 'touch',
        padding: '72px 30px calc(72px + env(safe-area-inset-bottom))',
      }}
    >
      <div className="w-full max-w-md" style={{ margin: 'auto' }}>
        {children}
      </div>
    </div>
  );
}

function joinList(values: string[]): string {
  if (values.length <= 2) return values.join(' and ');
  return `${values.slice(0, -1).join(', ')}, and ${values[values.length - 1]}`;
}

// ── Rooms ────────────────────────────────────────────────────────────────────
function OpenRoom({ active, reduced, opener, weekLabel }: { active: boolean; reduced: boolean; opener: Opener; weekLabel: string }) {
  const th = TH.open;
  const t = useTicker(active, reduced, 700);
  const n = useCountUp(opener.questionsRight, active && t >= 2, reduced);
  return (
    <Shell th={th}>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <Eyebrow color={th.accent}>
          Week {opener.weekIndex} · {weekLabel}
        </Eyebrow>
      </Reveal>
      <Reveal show={active && t >= 1} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 54, lineHeight: 1.04, fontWeight: 500, color: th.fg, marginBottom: 30 }}>
          Seven days of
          <br />
          knowing things.
        </div>
      </Reveal>
      <Reveal show={active && t >= 2} reduced={reduced}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
          <span style={{ fontFamily: SERIF, fontSize: 96, fontWeight: 600, color: th.accent, lineHeight: 1 }}>{n}</span>
          <span style={{ fontFamily: SANS, fontSize: 15, color: th.sub, maxWidth: 120 }}>questions you got right</span>
        </div>
      </Reveal>
    </Shell>
  );
}

function MasteredRoom({ active, reduced, list }: { active: boolean; reduced: boolean; list: Beat1 }) {
  const th = TH.mastered;
  const t = useTicker(active, reduced, 1100);
  return (
    <Shell th={th}>
      <Reveal show={active} reduced={reduced}>
        <Eyebrow color={th.accent}>What you mastered</Eyebrow>
      </Reveal>
      {list.map((m, i) => (
        <Reveal key={`${m.domain}-${m.toTier}`} show={active && t >= i} reduced={reduced} style={{ marginBottom: 28 }}>
          <div style={{ fontFamily: SANS, fontSize: 13, letterSpacing: 1, color: th.sub, marginBottom: 6 }}>
            {KNOWLEDGE_TIER_LABEL[m.fromTier]} <span style={{ color: th.accent }}>→</span> {KNOWLEDGE_TIER_LABEL[m.toTier]}
          </div>
          <div style={{ fontFamily: SERIF, fontSize: i === 0 ? 52 : 38, fontWeight: 600, lineHeight: 1, color: th.fg }}>
            {m.domain}
          </div>
        </Reveal>
      ))}
    </Shell>
  );
}

function MasteredFallbackRoom({ active, reduced, fallback }: { active: boolean; reduced: boolean; fallback: Beat1FriendFallback }) {
  const th = TH.mastered;
  const t = useTicker(active, reduced, 900);
  return (
    <Shell th={th}>
      <Reveal show={active} reduced={reduced}>
        <Eyebrow color={th.accent}>This week</Eyebrow>
      </Reveal>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 48, fontWeight: 600, lineHeight: 1.02, color: th.fg, marginBottom: 18 }}>
          {fallback.friendName} leveled up.
        </div>
      </Reveal>
      <Reveal show={active && t >= 1} reduced={reduced}>
        <div style={{ fontFamily: SANS, fontSize: 16, lineHeight: 1.5, color: th.sub }}>
          You didn&rsquo;t cross a tier this week. {fallback.friendName} crossed {fallback.count} in {joinList(fallback.domains)}.
        </div>
      </Reveal>
    </Shell>
  );
}

function DiscoveredRoom({ active, reduced, beat2 }: { active: boolean; reduced: boolean; beat2: Beat2 }) {
  const th = TH.discovered;
  const t = useTicker(active, reduced, 950);
  const items = beat2.friendMediated.length
    ? beat2.friendMediated
    : [...beat2.authored, ...beat2.promoted].map((d) => ({ domain: d.domain, via: null as string | null }));
  return (
    <Shell th={th}>
      <Reveal show={active} reduced={reduced}>
        <Eyebrow color={th.accent}>What you discovered</Eyebrow>
      </Reveal>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 500, color: th.fg, marginBottom: 26, lineHeight: 1.1 }}>
          New ground entered your map.
        </div>
      </Reveal>
      {items.slice(0, 4).map((d, i) => (
        <Reveal key={d.domain} show={active && t >= i + 1} reduced={reduced} style={{ marginBottom: 16 }}>
          <div style={{ fontFamily: SERIF, fontSize: 26, color: th.accent, fontWeight: 600, lineHeight: 1.05 }}>{d.domain}</div>
          {d.via ? (
            <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 15, color: th.sub }}>
              from a question {d.via} sent you
            </div>
          ) : null}
        </Reveal>
      ))}
    </Shell>
  );
}

function LearnedRoom({ active, reduced, beat6 }: { active: boolean; reduced: boolean; beat6: Beat6 }) {
  const th = TH.learned;
  const t = useTicker(active, reduced, 1000);
  return (
    <Shell th={th}>
      <Reveal show={active} reduced={reduced}>
        <Eyebrow color={th.accent}>What you worked through</Eyebrow>
      </Reveal>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 500, color: th.fg, marginBottom: 26, lineHeight: 1.12 }}>
          Things you didn&rsquo;t have
          <br />
          a week ago.
        </div>
      </Reveal>
      {beat6.map((item, i) => (
        <Reveal key={`${item.domain}-${i}`} show={active && t >= i + 1} reduced={reduced} style={{ marginBottom: 18 }}>
          <div style={{ fontFamily: SERIF, fontSize: 20, fontWeight: 600, color: th.fg, lineHeight: 1.25 }}>{item.questionText}</div>
          <div style={{ fontFamily: SANS, fontSize: 14, color: th.accent, marginTop: 4 }}>{item.correctAnswer}</div>
        </Reveal>
      ))}
    </Shell>
  );
}

function ShapedRoom({ active, reduced, list }: { active: boolean; reduced: boolean; list: Beat3 }) {
  const th = TH.shaped;
  const t = useTicker(active, reduced, 1000);
  const label = (count: number) => (count === 1 ? 'question' : 'questions');
  return (
    <Shell th={th}>
      <Reveal show={active} reduced={reduced}>
        <Eyebrow color={th.accent}>Who shaped your map</Eyebrow>
      </Reveal>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 500, color: th.fg, marginBottom: 26, lineHeight: 1.15 }}>
          Your week was built
          <br />
          by other people.
        </div>
      </Reveal>
      {list.map((s, i) => (
        <Reveal key={s.userId} show={active && t >= i + 1} reduced={reduced} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
            <span style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, color: th.accent, lineHeight: 1, minWidth: 18 }}>{i + 1}</span>
            <div>
              <div style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 600, color: th.fg, lineHeight: 1 }}>{s.displayName}</div>
              <div style={{ fontFamily: SANS, fontSize: 13.5, color: th.sub, marginTop: 3 }}>
                contributed {s.contributionCount} {label(s.contributionCount)} you got right
              </div>
            </div>
          </div>
        </Reveal>
      ))}
    </Shell>
  );
}

function AlignmentRoom({ active, reduced, a }: { active: boolean; reduced: boolean; a: Beat4 }) {
  const th = TH.alignment;
  const t = useTicker(active, reduced, 900);
  return (
    <Shell th={th}>
      <Reveal show={active} reduced={reduced}>
        <Eyebrow color={th.accent}>Your closest alignment</Eyebrow>
      </Reveal>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <div style={{ fontFamily: SANS, fontSize: 14, letterSpacing: 1, color: th.sub, marginBottom: 8 }}>You and</div>
      </Reveal>
      <Reveal show={active && t >= 1} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 80, fontWeight: 600, color: th.accent, lineHeight: 0.95, marginBottom: 24 }}>{a.displayName}</div>
      </Reveal>
      <Reveal show={active && t >= 2} reduced={reduced}>
        <div style={{ fontFamily: SANS, fontSize: 14, letterSpacing: 1, color: th.sub, marginBottom: 10 }}>most aligned in</div>
        {a.sharedDomains.map((d) => (
          <div key={d} style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 500, color: th.fg, lineHeight: 1.2 }}>{d}</div>
        ))}
      </Reveal>
    </Shell>
  );
}

function GaveRoom({ active, reduced, g }: { active: boolean; reduced: boolean; g: Beat5 }) {
  const th = TH.gave;
  const t = useTicker(active, reduced, 1000);
  const pts = useCountUp(Math.round(g.totalCreatorPoints), active && t >= 1, reduced);
  const answered = g.totalAnswered ?? g.topQuestion?.answeredCount ?? 0;
  return (
    <Shell th={th}>
      <Reveal show={active} reduced={reduced}>
        <Eyebrow color={th.accent}>What you gave</Eyebrow>
      </Reveal>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 30, fontWeight: 500, color: th.fg, marginBottom: 24, lineHeight: 1.15 }}>
          {answered} of your questions
          <br />
          were answered by friends.
        </div>
      </Reveal>
      <Reveal show={active && t >= 1} reduced={reduced}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 26 }}>
          <span style={{ fontFamily: SERIF, fontSize: 88, fontWeight: 600, color: th.accent, lineHeight: 1 }}>{pts}</span>
          <span style={{ fontFamily: SANS, fontSize: 14, color: th.sub }}>
            points you gave the
            <br />
            people around you
          </span>
        </div>
      </Reveal>
      {g.topQuestion ? (
        <Reveal show={active && t >= 2} reduced={reduced}>
          <div style={{ fontFamily: SANS, fontSize: 12, letterSpacing: 1, color: th.sub, marginBottom: 4 }}>YOUR MOST-PLAYED</div>
          <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 18, color: th.fg, lineHeight: 1.25 }}>
            &ldquo;{g.topQuestion.text}&rdquo;
          </div>
        </Reveal>
      ) : null}
    </Shell>
  );
}

function GaveFallbackRoom({ active, reduced, fallback }: { active: boolean; reduced: boolean; fallback: Beat5FriendFallback }) {
  const th = TH.gave;
  const t = useTicker(active, reduced, 900);
  return (
    <Shell th={th}>
      <Reveal show={active} reduced={reduced}>
        <Eyebrow color={th.accent}>What you gave</Eyebrow>
      </Reveal>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 44, fontWeight: 600, lineHeight: 1.04, color: th.fg, marginBottom: 18 }}>
          {fallback.friendName} taught the room.
        </div>
      </Reveal>
      <Reveal show={active && t >= 1} reduced={reduced}>
        <div style={{ fontFamily: SANS, fontSize: 16, lineHeight: 1.5, color: th.sub }}>
          You didn&rsquo;t earn author credit this week. {fallback.friendName}&rsquo;s questions earned{' '}
          {fallback.totalCreatorPoints} points for others.
        </div>
      </Reveal>
    </Shell>
  );
}

function CloseRoom({
  active,
  reduced,
  weekIndex,
  shareLoading,
  onShare,
  onDone,
  onReplay,
}: {
  active: boolean;
  reduced: boolean;
  weekIndex: number | null;
  shareLoading: boolean;
  onShare: (e: React.MouseEvent) => void;
  onDone: (e: React.MouseEvent) => void;
  onReplay: (e: React.MouseEvent) => void;
}) {
  const th = TH.close;
  const t = useTicker(active, reduced, 700);
  return (
    <Shell th={th}>
      <Reveal show={active && t >= 0} reduced={reduced}>
        <div style={{ fontFamily: MONO, fontSize: 11, letterSpacing: 4, color: th.accent, marginBottom: 18 }}>
          {weekIndex ? `WEEK ${weekIndex}` : 'THIS WEEK'}
        </div>
      </Reveal>
      <Reveal show={active && t >= 1} reduced={reduced}>
        <div style={{ fontFamily: SERIF, fontSize: 46, fontWeight: 500, color: th.fg, lineHeight: 1.05, marginBottom: 14 }}>
          This is who you
          <br />
          were this week.
        </div>
        <div style={{ fontFamily: SERIF, fontStyle: 'italic', fontSize: 18, color: th.sub, marginBottom: 34 }}>
          See you next Sunday.
        </div>
      </Reveal>
      <Reveal show={active && t >= 2} reduced={reduced} style={{ width: '100%' }}>
        <button
          type="button"
          onClick={onShare}
          disabled={shareLoading}
          style={{
            display: 'flex',
            width: '100%',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            background: 'var(--ceremony-open-bg)',
            color: 'var(--ceremony-paper)',
            fontFamily: SANS,
            fontSize: 13,
            letterSpacing: 3,
            padding: '15px 0',
            cursor: 'pointer',
            marginBottom: 12,
            boxShadow: `3px 3px 0 ${th.accent}`,
            border: 'none',
          }}
        >
          <Share2 className="size-4" />
          {shareLoading ? 'OPENING…' : 'SHARE THIS WEEK'}
        </button>
        <button
          type="button"
          onClick={onDone}
          style={{
            width: '100%',
            border: `1.5px solid ${th.fg}`,
            background: 'transparent',
            color: th.fg,
            fontFamily: SANS,
            fontSize: 13,
            letterSpacing: 3,
            padding: '15px 0',
            cursor: 'pointer',
            marginBottom: 12,
          }}
        >
          DONE
        </button>
        <button
          type="button"
          onClick={onReplay}
          style={{
            width: '100%',
            background: 'transparent',
            border: 'none',
            color: th.sub,
            fontFamily: MONO,
            fontSize: 11,
            letterSpacing: 3,
            cursor: 'pointer',
          }}
        >
          REPLAY
        </button>
      </Reveal>
    </Shell>
  );
}

// ── Chrome ───────────────────────────────────────────────────────────────────
function Pips({ n, total, fg }: { n: number; total: number; fg: string }) {
  return (
    <div
      className="absolute right-0 left-0 z-10 flex justify-center gap-1.5"
      style={{ top: 'max(1.25rem, env(safe-area-inset-top))' }}
    >
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          style={{
            width: i === n ? 16 : 5,
            height: 4,
            borderRadius: 4,
            background: fg,
            opacity: i === n ? 0.95 : 0.32,
            transition: 'all .3s',
          }}
        />
      ))}
    </div>
  );
}

function Hint({ fg, show }: { fg: string; show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="ceremony-hint-pulse absolute right-0 left-0 z-10 text-center"
      style={{
        bottom: 'max(1.5rem, env(safe-area-inset-bottom))',
        fontFamily: MONO,
        fontSize: 10,
        letterSpacing: 3,
        color: fg,
        opacity: 0.5,
      }}
    >
      TAP TO CONTINUE →
    </div>
  );
}

function formatRange(start: string, end: string): string {
  try {
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    return `${fmt.format(new Date(`${start}T00:00:00`))} – ${fmt.format(new Date(`${end}T00:00:00`))}`;
  } catch {
    return `${start} – ${end}`;
  }
}

type Room = { key: string; theme: RoomTheme; render: (active: boolean) => ReactNode };

export default function CeremonyPage() {
  const router = useRouter();
  const params = useParams<{ ceremonyId: string }>();
  const ceremonyId = params.ceremonyId;
  const reduced = usePrefersReducedMotion();

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

  const payload = ceremony?.beatsPayload ?? null;

  const rooms = useMemo<Room[]>(() => {
    if (!payload) return [];
    const list: Room[] = [];
    const weekLabel = formatRange(payload.cycleStart, payload.cycleEnd);

    if (payload.opener) {
      const opener = payload.opener;
      list.push({ key: 'open', theme: TH.open, render: (a) => <OpenRoom active={a} reduced={reduced} opener={opener} weekLabel={weekLabel} /> });
    }
    if (payload.beat1 && payload.beat1.length) {
      const b1 = payload.beat1;
      list.push({ key: 'mastered', theme: TH.mastered, render: (a) => <MasteredRoom active={a} reduced={reduced} list={b1} /> });
    } else if (payload.beat1FriendFallback) {
      const fb = payload.beat1FriendFallback;
      list.push({ key: 'mastered-fallback', theme: TH.mastered, render: (a) => <MasteredFallbackRoom active={a} reduced={reduced} fallback={fb} /> });
    }
    if (payload.beat2 && (payload.beat2.friendMediated.length || payload.beat2.authored.length || payload.beat2.promoted.length)) {
      const b2 = payload.beat2;
      list.push({ key: 'discovered', theme: TH.discovered, render: (a) => <DiscoveredRoom active={a} reduced={reduced} beat2={b2} /> });
    }
    if (payload.beat6 && payload.beat6.length) {
      const b6 = payload.beat6;
      list.push({ key: 'learned', theme: TH.learned, render: (a) => <LearnedRoom active={a} reduced={reduced} beat6={b6} /> });
    }
    if (payload.beat3 && payload.beat3.length) {
      const b3 = payload.beat3;
      list.push({ key: 'shaped', theme: TH.shaped, render: (a) => <ShapedRoom active={a} reduced={reduced} list={b3} /> });
    }
    if (payload.beat4 && payload.beat4.sharedDomains.length) {
      const b4 = payload.beat4;
      list.push({ key: 'alignment', theme: TH.alignment, render: (a) => <AlignmentRoom active={a} reduced={reduced} a={b4} /> });
    }
    if (payload.beat5) {
      const b5 = payload.beat5;
      list.push({ key: 'gave', theme: TH.gave, render: (a) => <GaveRoom active={a} reduced={reduced} g={b5} /> });
    } else if (payload.beat5FriendFallback) {
      const fb = payload.beat5FriendFallback;
      list.push({ key: 'gave-fallback', theme: TH.gave, render: (a) => <GaveFallbackRoom active={a} reduced={reduced} fallback={fb} /> });
    }

    list.push({
      key: 'close',
      theme: TH.close,
      render: (a) => (
        <CloseRoom
          active={a}
          reduced={reduced}
          weekIndex={payload.opener?.weekIndex ?? null}
          shareLoading={shareLoading}
          onShare={share}
          onDone={(e) => {
            e.stopPropagation();
            router.push('/');
          }}
          onReplay={(e) => {
            e.stopPropagation();
            setCurrentIndex(0);
          }}
        />
      ),
    });
    return list;
    // share/router are stable enough for this memo; shareLoading is the only
    // value the closer reads that changes, and it's in the deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payload, reduced, shareLoading]);

  const index = Math.min(currentIndex, Math.max(rooms.length - 1, 0));
  const isLast = index >= rooms.length - 1;

  function handleTap(event: React.MouseEvent<HTMLElement>) {
    const width = event.currentTarget.clientWidth;
    if (width > 0 && event.clientX < width * 0.3) {
      setCurrentIndex((value) => Math.max(value - 1, 0));
    } else {
      setCurrentIndex((value) => Math.min(value + 1, rooms.length - 1));
    }
  }

  async function share(event: React.MouseEvent) {
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

  if (error) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center" style={{ background: TH.open.bg, color: TH.open.fg }}>
        <p className="text-sm" style={{ color: TH.open.sub }}>{error}</p>
      </main>
    );
  }

  if (!ceremony || rooms.length === 0) {
    return (
      <main className="grid min-h-dvh place-items-center px-6 text-center" style={{ background: TH.open.bg, color: TH.open.fg }}>
        <p className="text-sm" style={{ color: TH.open.sub }}>Loading your week…</p>
      </main>
    );
  }

  const current = rooms[index]!;

  return (
    <main
      className="relative min-h-dvh cursor-pointer overflow-hidden"
      style={{ background: current.theme.bg }}
      onClick={handleTap}
    >
      <Pips n={index} total={rooms.length} fg={current.theme.fg} />

      <button
        type="button"
        aria-label="Exit"
        className="absolute z-20 grid size-11 place-items-center rounded-full transition hover:bg-white/10"
        style={{ top: 'max(1.25rem, env(safe-area-inset-top))', right: '1.25rem', color: current.theme.fg }}
        onClick={(event) => {
          event.stopPropagation();
          router.push('/');
        }}
      >
        <X className="size-6" />
      </button>

      {current.render(true)}

      <Hint fg={current.theme.fg} show={!isLast} />

      {shareUrl ? (
        <div
          className="fixed inset-0 z-30 flex items-center justify-center overflow-y-auto px-5 py-8"
          style={{ background: 'color-mix(in srgb, var(--brand-ink) 86%, transparent)' }}
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
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-stone-100 px-4 text-sm font-medium text-stone-950"
                onClick={(event) => {
                  event.stopPropagation();
                  copyShareUrl().catch(() => setToast('Could not copy link.'));
                }}
              >
                Copy link
              </button>
              <button
                type="button"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-stone-400 px-4 text-sm text-stone-50"
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
    </main>
  );
}
