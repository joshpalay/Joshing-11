'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Bell, Brain, Home, MoreHorizontal, Pencil, SlidersHorizontal, Star, User, Users } from 'lucide-react';

/**
 * Welcome tour — a self-contained first-run "overview".
 *
 * Reworked from the spotlight prototype per Josh's direction: rather than
 * overlaying the real (often-empty) home, the tour runs over a faithful, always
 * populated MOCK home rendered inside a phone-width column. It opens with a short
 * intro card ("here's a quick look around"), then a scroll-driven spotlight walks
 * five beats — the daily five, customize, the friends section (which uses the
 * inviter's name so it isn't empty), and arrows down to the Knowledge and
 * Questions tabs in the nav — and ends on a choice: Play Now, or explore first.
 *
 * Self-contained so the For-You sample and the nav targets are guaranteed to
 * exist; the spotlight box draws the dim + ring at each target's computed rect.
 * `forced` (dev replay) bypasses and never writes the seen-flag.
 */

type Beat = {
  target: string;
  label: string;
  copy: string;
  /** Target lives in the fixed bottom nav (don't pan the home to reach it). */
  inNav?: boolean;
};

export const WELCOME_TOUR_STORAGE_KEY = 'joshing.welcomeTourSeenAt';

export function clearWelcomeTourSeen(storageKey: string = WELCOME_TOUR_STORAGE_KEY): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // localStorage may be unavailable — nothing to clear.
  }
}

const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

const PAN_EASE = 'cubic-bezier(.25,.7,.25,1)';

const SCOPED_STYLE = `
.wts-root{position:fixed;inset:0;z-index:60;background:color-mix(in srgb, var(--brand-ink-950) 66%, transparent);}
.wts-col{position:relative;margin:0 auto;display:flex;height:100dvh;width:100%;max-width:420px;flex-direction:column;overflow:hidden;background:var(--brand-cream-page);}
.wts-strip{position:relative;z-index:63;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--brand-ink-950);color:var(--primary-foreground);padding:9px 16px;}
.wts-strip .wts-wm{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--brand-cream);}
.wts-strip .wts-skip{font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:color-mix(in srgb, var(--primary-foreground) 82%, transparent);background:color-mix(in srgb, var(--primary-foreground) 12%, transparent);border:none;border-radius:999px;padding:6px 13px;cursor:pointer;}
.wts-pips{display:flex;gap:5px;}
.wts-pips i{width:6px;height:6px;border-radius:50%;background:color-mix(in srgb, var(--primary-foreground) 28%, transparent);transition:background .3s;}
.wts-pips i.on{background:var(--brand-orange);}
.wts-stage{position:relative;flex:1;overflow:hidden;}
.wts-home{position:absolute;inset:0;padding:14px 12px 0;transition:transform .6s ${PAN_EASE};will-change:transform;}
.wts-nav{position:relative;z-index:6;pointer-events:none;display:flex;justify-content:space-around;align-items:center;background:var(--brand-card);border-top:1px solid var(--brand-border);padding:8px 0 10px;}
.wts-nav .wts-tab{display:flex;flex-direction:column;align-items:center;gap:3px;color:var(--brand-ink-400);}
.wts-nav .wts-tab.active{color:var(--brand-ink);}
.wts-nav .wts-tab .wts-lbl{font-size:9px;letter-spacing:.05em;text-transform:uppercase;}
.wts-spot{position:fixed;inset:0;z-index:62;pointer-events:none;opacity:0;transition:opacity .4s ease;}
.wts-spot.show{opacity:1;}
.wts-dim{position:absolute;background:color-mix(in srgb, var(--brand-ink-950) 66%, transparent);transition:top .6s ${PAN_EASE}, left .6s ${PAN_EASE}, width .4s ease, height .4s ease;}
.wts-ring{position:absolute;border-radius:13px;box-shadow:0 0 0 3px var(--brand-orange);transition:top .6s ${PAN_EASE}, left .6s ${PAN_EASE}, width .4s ease, height .4s ease;}
.wts-help{position:fixed;z-index:64;width:248px;opacity:0;pointer-events:none;transition:opacity .35s ease, top .5s ${PAN_EASE}, left .35s ease;}
.wts-help.show{opacity:1;}
.wts-help .wts-box{background:var(--brand-card);color:var(--brand-ink);border-radius:12px;padding:13px 15px;box-shadow:0 16px 40px -14px color-mix(in srgb, var(--brand-ink-950) 55%, transparent);position:relative;}
.wts-help .wts-k{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand-orange);margin-bottom:4px;}
.wts-help .wts-p{font-size:.95rem;line-height:1.4;color:var(--brand-ink-700);}
.wts-help .wts-p b{color:var(--brand-ink);font-weight:600;}
.wts-help .wts-arrow{position:absolute;width:0;height:0;}
.wts-help.below .wts-arrow{top:-8px;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:9px solid var(--brand-card);}
.wts-help.above .wts-arrow{bottom:-8px;border-left:9px solid transparent;border-right:9px solid transparent;border-top:9px solid var(--brand-card);}
.wts-hint{position:absolute;bottom:16px;left:0;right:0;z-index:65;display:flex;justify-content:center;pointer-events:none;}
.wts-hint span{display:inline-flex;align-items:center;gap:6px;background:color-mix(in srgb, var(--brand-ink-950) 82%, transparent);color:var(--primary-foreground);font-size:12px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;border-radius:999px;padding:7px 14px;box-shadow:0 6px 18px -8px color-mix(in srgb, var(--brand-ink-950) 60%, transparent);animation:wtsBob 1.6s ease-in-out infinite;}
@keyframes wtsBob{0%,100%{transform:translateY(0);}50%{transform:translateY(5px);}}
.wts-driver{position:absolute;inset:0;z-index:4;overflow-y:scroll;scrollbar-width:none;touch-action:pan-y;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;}
.wts-driver::-webkit-scrollbar{display:none;}
.wts-sheet{position:absolute;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;padding:24px;background:color-mix(in srgb, var(--brand-ink-950) 80%, transparent);}
/* The end card lets scroll/touch pass through to the driver below (so scrolling
   up exits it and revisits the beats); only its buttons capture taps. */
.wts-end{pointer-events:none;}
.wts-end button{pointer-events:auto;}
@media (prefers-reduced-motion:reduce){.wts-spot,.wts-dim,.wts-ring,.wts-help,.wts-hint,.wts-hint span,.wts-home{transition:none;animation:none;}}
`;

type WelcomeTourScreenProps = {
  /** Inviter display name for the For-You sample; falls back to "a friend". */
  inviterName?: string | null;
  /** Dev replay — never writes the seen-flag. */
  forced?: boolean;
  storageKey?: string;
  /** "Play Now" destination (into the round). */
  playHref?: string;
  /** "I'll explore more first" destination (the homepage). */
  exploreHref?: string;
};

export default function WelcomeTourScreen({
  inviterName,
  forced = false,
  storageKey = WELCOME_TOUR_STORAGE_KEY,
  playHref = '/daily',
  exploreHref = '/',
}: WelcomeTourScreenProps) {
  const router = useRouter();
  const isClient = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
  const inviter = inviterName?.trim() ? inviterName.trim() : 'a friend';

  const beats: Beat[] = useMemo(
    () => [
      {
        target: 'five',
        label: "Today's Five",
        copy: 'Your five questions for the day live here — tap <b>Play</b> to start. A fresh set lands every afternoon.',
      },
      {
        target: 'customize',
        label: 'Customize',
        copy: 'Different topics, or harder questions? <b>Tune them anytime</b> — right here.',
      },
      {
        target: 'friends',
        label: 'Your friends',
        copy: `When <b>${inviter}</b> sends you a question — or a friend aces one — it shows up here to answer back.`,
      },
      {
        target: 'activity',
        label: 'Activity',
        copy: 'Further down, <b>recent activity</b> shows what everyone you play with is up to.',
      },
      {
        target: 'questions',
        label: 'Questions',
        copy: 'Questions <b>you write</b> to ask your friends live in this tab.',
        inNav: true,
      },
      {
        target: 'knowledge',
        label: 'Knowledge',
        copy: 'Watch your <b>knowledge grow</b> across every topic — it lives in this tab.',
        inNav: true,
      },
    ],
    [inviter],
  );

  const [started, setStarted] = useState(false);
  const [stepIndex, setStepIndex] = useState(-1);
  const [atEnd, setAtEnd] = useState(false);

  const homeRef = useRef<HTMLDivElement | null>(null);
  const spotRef = useRef<HTMLDivElement | null>(null);
  const dimTRef = useRef<HTMLDivElement | null>(null);
  const dimBRef = useRef<HTMLDivElement | null>(null);
  const dimLRef = useRef<HTMLDivElement | null>(null);
  const dimRRef = useRef<HTMLDivElement | null>(null);
  const ringRef = useRef<HTMLDivElement | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const helpKRef = useRef<HTMLParagraphElement | null>(null);
  const helpPRef = useRef<HTMLParagraphElement | null>(null);
  const arrowRef = useRef<HTMLSpanElement | null>(null);
  const driverRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const startedRef = useRef(false);
  const atEndRef = useRef(false);
  const currentRef = useRef(-1);
  const panRef = useRef(0);
  const dwellRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastIndex = beats.length - 1;

  const markSeen = () => {
    if (forced) return;
    try {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // best-effort
    }
  };

  const geomRef = useRef({ top: 0, left: 0, width: 0, height: 0 });
  const PAD = 8;

  const placeSpotlight = (n: number): boolean => {
    const beat = beats[n];
    const stage = stageRef.current;
    const home = homeRef.current;
    const spot = spotRef.current;
    const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(beat.target)}"]`);
    if (!stage || !spot || !el) return false;

    if (beat.inNav) {
      // Nav targets are fixed at the bottom — show the whole home, don't pan.
      panRef.current = 0;
      if (home) home.style.transform = 'translateY(0)';
      const r = el.getBoundingClientRect();
      geomRef.current = { top: r.top, left: r.left, width: r.width, height: r.height };
    } else {
      const stageRect = stage.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      // Settle the target ~32% down the stage; never pan past the top.
      const want = stageRect.top + stageRect.height * 0.32;
      const drift = r.top - want;
      const newPan = Math.min(0, panRef.current - drift);
      const delta = newPan - panRef.current;
      panRef.current = newPan;
      if (home) home.style.transform = `translateY(${newPan}px)`;
      geomRef.current = { top: r.top + delta, left: r.left, width: r.width, height: r.height };
    }

    const dimT = dimTRef.current;
    const dimB = dimBRef.current;
    const dimL = dimLRef.current;
    const dimR = dimRRef.current;
    const ring = ringRef.current;
    if (!dimT || !dimB || !dimL || !dimR || !ring) return false;

    const g = geomRef.current;
    const x0 = g.left - PAD;
    const y0 = g.top - PAD;
    const w = g.width + PAD * 2;
    const h = g.height + PAD * 2;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const box = (
      e: HTMLDivElement,
      left: number,
      top: number,
      width: number,
      height: number,
    ) => {
      e.style.left = `${left}px`;
      e.style.top = `${top}px`;
      e.style.width = `${Math.max(0, width)}px`;
      e.style.height = `${Math.max(0, height)}px`;
    };
    // Four scrim panels frame a transparent window over the target (no giant
    // box-shadow, so iOS keeps the scroll gesture). Top/bottom span full width
    // so the corners are covered.
    box(dimT, 0, 0, vw, y0);
    box(dimB, 0, y0 + h, vw, vh - (y0 + h));
    box(dimL, 0, y0, x0, h);
    box(dimR, x0 + w, y0, vw - (x0 + w), h);
    box(ring, x0, y0, w, h);
    spot.classList.add('show');
    return true;
  };

  const placeHelp = (n: number) => {
    const beat = beats[n];
    const help = helpRef.current;
    if (!help || !helpKRef.current || !helpPRef.current || !arrowRef.current) return;
    helpKRef.current.textContent = beat.label;
    helpPRef.current.innerHTML = beat.copy;
    const hw = Math.min(248, window.innerWidth - 28);
    help.style.width = `${hw}px`;
    help.style.visibility = 'hidden';
    help.classList.add('show');
    const hh = help.offsetHeight;
    const g = geomRef.current;
    // Place inside the safe band: below the strip, above the bottom nav. Prefer
    // below the target; flip above when below would overflow (e.g. a tall
    // section, or a nav target at the very bottom); then clamp into the band so
    // the tooltip is never cut off.
    const navEl = document.querySelector<HTMLElement>('.wts-nav');
    const stripEl = document.querySelector<HTMLElement>('.wts-strip');
    const bottomSafe = (navEl ? navEl.getBoundingClientRect().top : window.innerHeight) - 8;
    const topSafe = (stripEl ? stripEl.getBoundingClientRect().bottom : 0) + 8;
    let below = true;
    let top = g.top + g.height + PAD + 12;
    if (top + hh > bottomSafe) {
      below = false;
      top = g.top - hh - 12;
    }
    top = Math.max(topSafe, Math.min(top, bottomSafe - hh));
    let left = g.left + g.width / 2 - hw / 2;
    left = Math.max(10, Math.min(left, window.innerWidth - hw - 10));
    help.classList.toggle('below', below);
    help.classList.toggle('above', !below);
    help.style.left = `${left}px`;
    help.style.top = `${top}px`;
    help.style.visibility = 'visible';
    let ax = g.left + g.width / 2 - left - 9;
    ax = Math.max(14, Math.min(ax, hw - 26));
    arrowRef.current.style.left = `${ax}px`;
  };

  const goToStep = (n: number) => {
    if (n === currentRef.current) return;
    currentRef.current = n;
    setStepIndex(n);
    helpRef.current?.classList.remove('show');
    const placed = placeSpotlight(n);
    if (dwellRef.current) clearTimeout(dwellRef.current);
    if (placed) {
      dwellRef.current = setTimeout(() => placeHelp(n), 280);
    }
  };

  const onDrive = () => {
    const driver = driverRef.current;
    if (!startedRef.current || !driver) return;
    const max = driver.scrollHeight - driver.clientHeight;
    const p = max > 0 ? Math.min(1, Math.max(0, driver.scrollTop / max)) : 0;
    // One slot past the last beat is the (reversible) end card — scrolling back
    // up returns to the beats and re-shows the spotlight.
    const positions = beats.length + 1;
    const idx = Math.min(beats.length, Math.floor(p * positions * 0.999));
    if (idx >= beats.length) {
      if (!atEndRef.current) {
        atEndRef.current = true;
        setAtEnd(true);
        spotRef.current?.classList.remove('show');
        helpRef.current?.classList.remove('show');
        markSeen();
      }
      return;
    }
    if (atEndRef.current) {
      atEndRef.current = false;
      setAtEnd(false);
      currentRef.current = -1; // force the current beat to re-place on the way back
    }
    goToStep(idx);
  };

  const startTour = () => {
    setStarted(true);
    startedRef.current = true;
    // Place the first beat on the next frame (refs are mounted).
    requestAnimationFrame(() => goToStep(0));
  };

  const finish = (href: string) => {
    markSeen();
    router.push(href);
  };

  if (!isClient) return null;

  return (
    <div className="wts-root">
      <style>{SCOPED_STYLE}</style>
      <div className="wts-col">
        {/* Top strip */}
        <div className="wts-strip">
          <span className="wts-wm">Welcome — a quick look around</span>
          <div className="wts-pips" aria-hidden="true">
            {beats.map((b, n) => (
              <i key={b.target} className={n <= stepIndex ? 'on' : ''} />
            ))}
          </div>
          <button type="button" className="wts-skip" onClick={() => finish(exploreHref)}>
            Skip
          </button>
        </div>

        {/* Stage: the mock home (pans) */}
        <div className="wts-stage" ref={stageRef}>
          <div className="wts-home" ref={homeRef}>
            <div className="mb-3 flex items-center justify-between">
              <span className="font-serif text-[1.35rem] font-semibold text-[var(--brand-ink)]">
                Joshing
              </span>
              <span className="flex items-center gap-2 text-[var(--brand-ink-400)]">
                <Bell className="size-[18px]" strokeWidth={1.9} />
                <span className="grid size-6 place-items-center rounded-full bg-[var(--brand-border)] text-[10px] font-semibold text-[var(--brand-ink-700)]">
                  JP
                </span>
              </span>
            </div>

            {/* Today's Five — `five` + `customize` */}
            <div
              data-tour="five"
              className="text-card-foreground w-full rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-[var(--feed-card-elevated)] px-4 py-4 shadow-[var(--shadow-card)]"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-[13px] font-bold tracking-[0.12em] text-[var(--brand-ink-700)] uppercase">
                  Today&apos;s Five
                </p>
                <span
                  data-tour="customize"
                  className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-[color-mix(in_srgb,var(--brand-border)_60%,transparent)] bg-[var(--brand-cream-page)] px-3 py-1.5 text-[12px] font-bold text-[var(--brand-ink)]"
                >
                  <SlidersHorizontal className="size-4" strokeWidth={2.4} aria-hidden="true" />
                  Customize
                </span>
              </div>
              <h2 className="mt-1 mb-2 font-serif text-[28px] leading-[34px] font-medium text-[var(--brand-ink)]">
                Ready when you are!
              </h2>
              <div className="mt-2 flex items-center gap-2" aria-hidden="true">
                {[0, 1, 2, 3, 4].map((d) => (
                  <span
                    key={d}
                    className="block size-[10px] rounded-full"
                    style={{ border: '1px solid color-mix(in srgb, var(--brand-ink) 35%, transparent)' }}
                  />
                ))}
              </div>
              <span className="btn-primary mt-3 w-full">Play now</span>
            </div>

            {/* Friends section — `friends` (For You + From Friends merged) */}
            <section data-tour="friends" className="mt-5">
              <p className="mb-2 pl-0.5 text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink-400)] uppercase">
                For you
              </p>
              {/* For You — mirrors SparkleEnvelope (the real directed-send card):
                  sans signal + overflow, a short rule, the serif question with
                  faded quotes, Dismiss / Answer. */}
              <article className="rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-[var(--feed-card-elevated)] p-3.5">
                <div className="flex w-full items-start justify-between gap-3">
                  <p className="font-sans text-[15px] leading-[23px] tracking-[0.05em] text-[var(--brand-ink)]">
                    <span className="font-semibold">{inviter}</span> sent you a question they wrote
                  </p>
                  <MoreHorizontal
                    className="size-5 shrink-0 text-[var(--brand-ink-400)]"
                    aria-hidden="true"
                  />
                </div>
                <div aria-hidden="true" className="mx-auto my-4 h-px w-[70px] bg-[var(--brand-rule)]" />
                <p className="font-serif text-2xl font-semibold leading-[32px] tracking-[0.05em] text-[var(--brand-ink)]">
                  <span aria-hidden="true" className="opacity-60">
                    &ldquo;
                  </span>
                  In the surrey with the fringe on top, what was the dashboard made of?
                  <span aria-hidden="true" className="opacity-60">
                    &rdquo;
                  </span>
                </p>
                <div className="mt-5 flex items-center justify-between">
                  <span className="text-sm font-medium text-[var(--brand-ink-400)]">Dismiss</span>
                  <span className="btn-primary">Answer</span>
                </div>
              </article>
              <p className="mt-4 mb-2 pl-0.5 text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink)] uppercase">
                From Friends
              </p>
              <div className="rounded-[var(--radius-xs)] border border-[var(--brand-border)] bg-[var(--brand-card)] p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-serif text-[1.1rem] font-semibold text-[var(--brand-ink)]">
                    {inviter}
                  </p>
                  {/* The friend's streak — five aced questions, one Joshing
                      triangle each (the brand motif). */}
                  <div className="flex items-end gap-1" aria-label="5 of 5 aced">
                    {[
                      'var(--tri-orange)',
                      'var(--tri-darkyellow)',
                      'var(--tri-darkteal)',
                      'var(--tri-lightteal)',
                      'var(--tri-amber)',
                    ].map((c, i) => (
                      <svg key={i} width="15" height="13" viewBox="0 0 16 14" aria-hidden="true">
                        <polygon points="8,0 16,14 0,14" style={{ fill: c }} />
                      </svg>
                    ))}
                  </div>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[var(--brand-ink-700)]">
                  aced all five in Tennis Fundamentals this week — play the same set.
                </p>
                <div className="mt-3 flex items-center justify-end">
                  <span className="text-[13px] font-semibold text-[var(--brand-ink-700)]">Play →</span>
                </div>
              </div>
            </section>

            {/* Recent activity — lower on the page (beat ~3.5). Mirrors the real
                feed: a milestone row, then the sage "Overlap" common-ground band
                (EditorialFeature, interlude-sage). */}
            <section data-tour="activity" className="mt-6">
              <p className="mb-3 pl-0.5 text-[13px] font-bold tracking-[0.1em] text-[var(--brand-ink)] uppercase">
                Recent activity
              </p>
              <div className="flex items-start gap-2.5 pl-0.5">
                <Star
                  className="mt-0.5 size-4 shrink-0 text-[var(--accent-gold)]"
                  fill="currentColor"
                  aria-hidden="true"
                />
                <p className="text-sm leading-6 text-[var(--brand-ink-700)]">
                  <span className="font-semibold text-[var(--brand-ink)]">Someone</span> played their
                  first five questions
                </p>
              </div>

              {/* Common ground — the full-bleed sage editorial band. -mx-3 cancels
                  the mock home's 12px gutter so it reaches the column edges. */}
              <div className="-mx-3 mt-5 bg-[var(--interlude-sage)] px-5 pt-8 pb-8">
                <h3 className="max-w-[20ch] font-serif text-[26px] leading-[1.15] font-medium text-[var(--brand-ink)]">
                  You and {inviter} keep meeting in the same places.
                </h3>
                <div className="mt-7 flex items-start gap-8">
                  {[
                    { label: 'American City Nicknames', color: 'var(--tri-orange)' },
                    { label: 'Bikini Bottom Animated Series', color: 'var(--brand-navy)' },
                  ].map((d) => (
                    <span key={d.label} className="flex flex-col gap-2">
                      <span
                        className="block size-12 rounded-full"
                        style={{ background: d.color }}
                        aria-hidden="true"
                      />
                      <span className="max-w-[120px] font-serif text-[13px] leading-snug text-[var(--brand-ink-400)]">
                        {d.label}
                      </span>
                    </span>
                  ))}
                </div>
                <p className="mt-4 font-serif text-[15px] font-semibold text-[var(--brand-ink)]">
                  {inviter}
                </p>
                <p className="mt-5 font-sans text-[13px] tracking-[0.12em] text-[var(--brand-ink-400)] uppercase">
                  Shared ground with 1 friend
                </p>
                <span className="mt-3 inline-flex min-h-11 items-center font-sans text-[13px] font-medium tracking-[0.12em] text-[var(--ink)] uppercase underline underline-offset-4">
                  Explore your overlap →
                </span>
              </div>
            </section>
          </div>

          {/* scroll hint while touring */}
          {started && !atEnd ? (
            <div className="wts-hint" aria-hidden="true">
              <span>{stepIndex >= lastIndex ? 'Keep scrolling to finish ↓' : 'Scroll to explore ↓'}</span>
            </div>
          ) : null}

          {/* invisible scroll driver (only meaningful once started). The tall
              spacer sets the scroll distance per step — bigger = less twitchy. */}
          <div className="wts-driver" ref={driverRef} onScroll={onDrive}>
            <div style={{ height: `${(beats.length + 1) * 160}%` }} />
          </div>
        </div>

        {/* Bottom nav — `knowledge` + `questions` targets */}
        <div className="wts-nav">
          <span className="wts-tab active">
            <Home className="size-5" strokeWidth={2} />
            <span className="wts-lbl">Home</span>
          </span>
          <span className="wts-tab" data-tour="questions">
            <Pencil className="size-5" strokeWidth={1.8} />
            <span className="wts-lbl">Questions</span>
          </span>
          <span className="wts-tab" data-tour="knowledge">
            <Brain className="size-5" strokeWidth={1.8} />
            <span className="wts-lbl">Knowledge</span>
          </span>
          <span className="wts-tab">
            <Users className="size-5" strokeWidth={1.8} />
            <span className="wts-lbl">Friends</span>
          </span>
        </div>

        {/* Spotlight + helper (fixed to viewport) */}
        <div className="wts-spot" ref={spotRef} aria-hidden="true">
          <div className="wts-dim" ref={dimTRef} />
          <div className="wts-dim" ref={dimBRef} />
          <div className="wts-dim" ref={dimLRef} />
          <div className="wts-dim" ref={dimRRef} />
          <div className="wts-ring" ref={ringRef} />
        </div>
        <div className="wts-help" ref={helpRef} role="status" aria-live="polite">
          <div className="wts-box">
            <span className="wts-arrow" ref={arrowRef} aria-hidden="true" />
            <p className="wts-k" ref={helpKRef} />
            <p className="wts-p" ref={helpPRef} />
          </div>
        </div>

        {/* Intro card (before start) — a contained cream card, matching login. */}
        {!started ? (
          <div className="wts-sheet">
            <div className="w-full max-w-[18rem] rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--brand-cream-card)] px-7 py-8 text-center shadow-[var(--shadow-overlay)]">
              <User
                className="mx-auto size-9 text-[var(--brand-ink-400)]"
                strokeWidth={1.6}
                aria-hidden="true"
              />
              <h2 className="mt-3 font-serif text-3xl font-semibold leading-tight text-[var(--brand-ink)]">
                A quick look around
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
                Here&apos;s where everything lives. About 20 seconds — then you&apos;re playing.
              </p>
              <button type="button" className="btn-primary mt-5 w-full" onClick={startTour}>
                Start the tour
              </button>
              <button
                type="button"
                className="mt-3 text-sm font-medium text-[var(--brand-ink-400)] underline underline-offset-4 hover:text-[var(--brand-ink)]"
                onClick={() => finish(exploreHref)}
              >
                Skip the tour
              </button>
            </div>
          </div>
        ) : null}

        {/* End card (after the last beat) — same card; pass-through so scrolling
            up exits and revisits the beats. */}
        {started && atEnd ? (
          <div className="wts-sheet wts-end">
            <div className="w-full max-w-[18rem] rounded-[var(--radius-md)] border border-[var(--brand-border)] bg-[var(--brand-cream-card)] px-7 py-8 text-center shadow-[var(--shadow-overlay)]">
              <h2 className="font-serif text-3xl font-semibold leading-tight text-[var(--brand-ink)]">
                That&apos;s the tour.
              </h2>
              <p className="mt-2 text-sm leading-6 text-[var(--brand-ink-700)]">
                Your five are ready whenever you are. Scroll up to look again.
              </p>
              <button type="button" className="btn-primary mt-5 w-full" onClick={() => finish(playHref)}>
                Play Now →
              </button>
              <button
                type="button"
                className="mt-3 text-sm font-medium text-[var(--brand-ink-400)] underline underline-offset-4 hover:text-[var(--brand-ink)]"
                onClick={() => finish(exploreHref)}
              >
                I&apos;ll explore more first
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
