'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

// Client-only readiness without a setState-in-effect: false during SSR, true
// once hydrated. Portals (and DOM measurement) need the browser document.
const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * Welcome tour — a first-run coach-mark walk over the REAL, live home.
 *
 * Ported from the standalone `welcome-coachmarks.html` prototype into a
 * reusable client component. It does NOT render its own home: it overlays the
 * page that mounts it, locating sections by `data-tour="<id>"` anchors and
 * pointing short callouts at them one at a time. The page settles on each
 * section (scroll-snap), the callout fades while scrolling between sections and
 * rests once settled, and a closing panel at the very bottom drops the player
 * straight into playing their Five.
 *
 * Anchoring is best-effort: steps whose `data-tour` target isn't on the page
 * are skipped (the live home only carries some anchors today; the dev preview
 * at /dev/welcome-tour carries all five). Progress pips reflect only the steps
 * that actually resolve to a target.
 *
 * Activation/suppression is client-side (no migration): the live home mounts
 * this when it sees `?welcome=1`; once the tour is completed or skipped a
 * one-time flag is persisted to localStorage so it doesn't reappear. The dev
 * preview passes `forced` to bypass — and to never write — that flag, keeping
 * the replay read-only against real state.
 */

export type WelcomeTourStep = {
  /** Matches a `data-tour="<target>"` attribute on the page. */
  target: string;
  /** Small-caps eyebrow above the callout copy. */
  label: string;
  /** The callout body. */
  copy: string;
};

export const WELCOME_TOUR_STORAGE_KEY = 'joshing.welcomeTourSeenAt';

// Canonical five callouts (build brief). Order matters: Today's Five fires
// before Customize even though Customize lives inside the Five card — the
// scroll gate below keeps them from competing.
export const DEFAULT_WELCOME_TOUR_STEPS: WelcomeTourStep[] = [
  {
    target: 'five',
    label: "Today's Five",
    copy: 'Your five questions for the day show up right here — tap Play to start. A new set lands every afternoon.',
  },
  {
    target: 'customize',
    label: 'Customize',
    copy: "Want different topics or harder questions? Change them anytime — it's right here.",
  },
  {
    target: 'foryou',
    label: 'For You',
    copy: "Questions a friend sends or writes just for you land here. Answer back and they'll see how you did.",
  },
  {
    target: 'friends',
    label: 'From Friends',
    copy: 'Questions your friends have aced this week. Jump in on the same ones and see how you stack up.',
  },
  {
    target: 'shared',
    label: 'Shared Ground',
    copy: 'Where you and your friends overlap — and where to find more people to play with.',
  },
];

type WelcomeTourCopy = {
  header: { eyebrow: string; title: string; body: string };
  barLabel: string;
  closer: { eyebrow: string; title: string; body: string; cta: string };
};

const DEFAULT_COPY: WelcomeTourCopy = {
  header: {
    eyebrow: 'Welcome to Joshing',
    title: "Let's take a quick look around.",
    body: "Scroll down — we'll point out what's what. Your five are ready whenever you are.",
  },
  barLabel: 'A quick tour',
  closer: {
    eyebrow: "That's the tour",
    title: 'Your Five are ready.',
    body: 'Everything else fills in as you and your friends play. Jump in.',
    cta: 'Play my Five →',
  },
};

type WelcomeTourProps = {
  steps?: WelcomeTourStep[];
  copy?: Partial<WelcomeTourCopy>;
  /** Element id (rendered in page flow) the sticky header portals into. */
  headerSlotId?: string;
  /** Element id (rendered in page flow) the closing panel portals into. */
  closerSlotId?: string;
  /**
   * Bypass the persisted seen-flag and never write it. Used by the dev preview
   * so a replay never mutates real seen-state.
   */
  forced?: boolean;
  /** Persisted suppression key (localStorage). */
  storageKey?: string;
  /**
   * Where the closing CTA routes. Serializable, so server components can set it
   * (e.g. the walkthrough chains into the building state). Defaults to `/daily`.
   */
  playHref?: string;
  /** Closing CTA handler. Overrides `playHref` when provided. */
  onPlay?: () => void;
  /** Skip/close handler. Defaults to stripping `?welcome` and staying on home. */
  onClose?: () => void;
};

/** Clears the persisted seen-flag so the live tour can re-arm (dev affordance). */
export function clearWelcomeTourSeen(storageKey: string = WELCOME_TOUR_STORAGE_KEY): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // localStorage can be unavailable (private mode) — nothing to clear.
  }
}

const SCOPED_STYLE = `
.welcome-tour-header{position:sticky;top:0;z-index:50;background:var(--brand-ink-950);color:var(--primary-foreground);overflow:hidden;border-bottom-left-radius:var(--radius-xs);border-bottom-right-radius:var(--radius-xs);}
.welcome-tour-header .wt-inner{position:relative;}
.welcome-tour-header .wt-big{transition:opacity .3s ease,max-height .35s ease,padding .35s ease;max-height:240px;}
.welcome-tour-header[data-shrunk="true"] .wt-big{max-height:0;opacity:0;padding-top:0;padding-bottom:0;}
.welcome-tour-header .wt-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;height:0;opacity:0;overflow:hidden;transition:opacity .3s ease,height .35s ease;}
.welcome-tour-header[data-shrunk="true"] .wt-bar{height:46px;opacity:1;}
.welcome-tour-coach{position:fixed;z-index:60;max-width:260px;pointer-events:none;opacity:0;transition:opacity .35s ease,top .45s cubic-bezier(.3,.7,.3,1),left .45s ease;}
.welcome-tour-coach.is-shown{opacity:1;}
.welcome-tour-arrow{position:absolute;width:0;height:0;}
.welcome-tour-coach.arrow-up .welcome-tour-arrow{top:-7px;border-left:8px solid transparent;border-right:8px solid transparent;border-bottom:8px solid var(--brand-ink-950);}
.welcome-tour-coach.arrow-down .welcome-tour-arrow{bottom:-7px;border-left:8px solid transparent;border-right:8px solid transparent;border-top:8px solid var(--brand-ink-950);}
.welcome-tour-lit{box-shadow:0 0 0 3px var(--brand-orange),0 0 0 9px color-mix(in srgb, var(--brand-orange) 18%, transparent);border-radius:var(--radius-xs);position:relative;z-index:30;transition:box-shadow .4s ease,border-radius .2s;}
.welcome-tour-pips{display:flex;gap:5px;}
.welcome-tour-pips i{width:6px;height:6px;border-radius:50%;background:color-mix(in srgb, var(--primary-foreground) 28%, transparent);transition:background .3s;}
.welcome-tour-pips i.on{background:var(--brand-orange);}
@media (prefers-reduced-motion:reduce){.welcome-tour-coach,.welcome-tour-lit,.welcome-tour-header .wt-big,.welcome-tour-header .wt-bar{transition:none;}}
`;

export default function WelcomeTour({
  steps = DEFAULT_WELCOME_TOUR_STEPS,
  copy: copyOverride,
  headerSlotId = 'welcome-tour-header-slot',
  closerSlotId = 'welcome-tour-closer-slot',
  forced = false,
  storageKey = WELCOME_TOUR_STORAGE_KEY,
  playHref = '/daily',
  onPlay,
  onClose,
}: WelcomeTourProps) {
  const router = useRouter();
  const copy: WelcomeTourCopy = {
    header: { ...DEFAULT_COPY.header, ...copyOverride?.header },
    barLabel: copyOverride?.barLabel ?? DEFAULT_COPY.barLabel,
    closer: { ...DEFAULT_COPY.closer, ...copyOverride?.closer },
  };

  const isClient = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
  // `closed` collapses the tour after a skip/play; combined with the persisted
  // seen-flag (read once on the client) it gives `inactive`.
  const [closed, setClosed] = useState(false);
  const [shrunk, setShrunk] = useState(false);
  // Index of the current pip-highlighted step (or -1 between/at edges).
  const [pipIndex, setPipIndex] = useState(-1);

  const headerRef = useRef<HTMLDivElement | null>(null);
  const coachRef = useRef<HTMLDivElement | null>(null);
  const coachLabelRef = useRef<HTMLParagraphElement | null>(null);
  const coachCopyRef = useRef<HTMLParagraphElement | null>(null);
  const arrowRef = useRef<HTMLSpanElement | null>(null);

  const currentRef = useRef(-1);
  const endedRef = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read external (browser) state into render the lint-sanctioned way: a
  // useSyncExternalStore snapshot returning a STABLE PRIMITIVE, with arrays
  // derived via useMemo. No setState-in-effect, no ref reads during render.

  // Whether the tour was already seen (persisted flag). `forced` ignores it.
  const seen = useSyncExternalStore(
    subscribeNoop,
    () => {
      if (forced) return false;
      try {
        return Boolean(window.localStorage.getItem(storageKey));
      } catch {
        return false;
      }
    },
    () => false,
  );

  // A stable signature of which step targets are present in the DOM ("1"/"0"
  // per step). Resolves after hydration; all-"0" during SSR.
  const presenceKey = useSyncExternalStore(
    subscribeNoop,
    () =>
      steps
        .map((step) =>
          document.querySelector(`[data-tour="${CSS.escape(step.target)}"]`) ? '1' : '0',
        )
        .join(''),
    () => steps.map(() => '0').join(''),
  );
  // Steps with a live target drive the pips + navigation. Fall back to all
  // steps if nothing resolved yet (SSR / pre-hydration).
  const activeSteps = useMemo(() => {
    const resolved = steps.filter((_, index) => presenceKey[index] === '1');
    return resolved.length > 0 ? resolved : steps;
  }, [steps, presenceKey]);

  const inactive = closed || seen;

  const markSeen = useCallback(() => {
    if (forced) return;
    try {
      window.localStorage.setItem(storageKey, new Date().toISOString());
    } catch {
      // Best-effort — a write failure just means the tour may show again.
    }
  }, [forced, storageKey]);

  const handleClose = useCallback(() => {
    endedRef.current = true;
    markSeen();
    setClosed(true);
    if (onClose) {
      onClose();
    } else if (!forced) {
      // Strip ?welcome so a refresh doesn't re-enter the tour.
      router.replace(window.location.pathname);
    }
  }, [forced, markSeen, onClose, router]);

  const handlePlay = useCallback(() => {
    markSeen();
    if (onPlay) {
      onPlay();
    } else {
      router.push(playHref);
    }
  }, [markSeen, onPlay, playHref, router]);

  // Core scroll engine: header shrink, step selection (snap & dwell), and
  // coach-mark placement. Mirrors the prototype, mutating the coach via refs so
  // scroll stays cheap; React state only carries the pip index + shrink.
  useEffect(() => {
    if (inactive || !isClient) return;

    const placeCoach = (step: WelcomeTourStep) => {
      const el = document.querySelector<HTMLElement>(
        `[data-tour="${CSS.escape(step.target)}"]`,
      );
      const coach = coachRef.current;
      if (!el || !coach || !coachLabelRef.current || !coachCopyRef.current || !arrowRef.current) {
        return;
      }
      const r = el.getBoundingClientRect();
      coachLabelRef.current.textContent = step.label;
      coachCopyRef.current.textContent = step.copy;
      // Measure before showing.
      coach.style.visibility = 'hidden';
      coach.classList.add('is-shown');
      const cw = Math.min(260, window.innerWidth - 32);
      coach.style.width = `${cw}px`;
      const ch = coach.offsetHeight;
      // Keep the callout inside a safe band: below the sticky welcome bar and
      // above the app's fixed bottom nav, so it never collides with chrome.
      const TOP_SAFE = 64;
      const BOTTOM_SAFE = 96;
      const roomBelow = window.innerHeight - BOTTOM_SAFE - (r.bottom + 12);
      const roomAbove = r.top - 12 - TOP_SAFE;
      const below = roomBelow >= ch || roomBelow >= roomAbove;
      let top = below ? r.bottom + 12 : r.top - ch - 12;
      top = Math.max(TOP_SAFE, Math.min(top, window.innerHeight - BOTTOM_SAFE - ch));
      coach.classList.toggle('arrow-up', below);
      coach.classList.toggle('arrow-down', !below);
      // Center on the target, clamp to the viewport; arrow follows the target.
      let left = r.left + r.width / 2 - cw / 2;
      left = Math.max(8, Math.min(left, window.innerWidth - cw - 8));
      coach.style.left = `${left}px`;
      coach.style.top = `${top}px`;
      coach.style.visibility = 'visible';
      let ax = r.left + r.width / 2 - left - 8;
      ax = Math.max(14, Math.min(ax, cw - 26));
      arrowRef.current.style.left = `${ax}px`;
      document
        .querySelectorAll('[data-tour].welcome-tour-lit')
        .forEach((node) => node.classList.remove('welcome-tour-lit'));
      el.classList.add('welcome-tour-lit');
    };

    const hideCoach = () => {
      coachRef.current?.classList.remove('is-shown');
      document
        .querySelectorAll('[data-tour].welcome-tour-lit')
        .forEach((node) => node.classList.remove('welcome-tour-lit'));
    };

    const evaluate = () => {
      if (endedRef.current) return;
      setShrunk(window.scrollY > 40);

      const tourSteps = activeSteps;

      // Closing panel in view — retire the callouts and fill the pips.
      const closer = document.getElementById(closerSlotId);
      if (closer) {
        const cr = closer.getBoundingClientRect();
        if (cr.top < window.innerHeight * 0.6) {
          hideCoach();
          setPipIndex(tourSteps.length - 1);
          currentRef.current = tourSteps.length;
          markSeen();
          return;
        }
      }

      const cy = window.innerHeight * 0.5;
      let best = -1;
      let bestD = Infinity;
      tourSteps.forEach((step, n) => {
        const el = document.querySelector<HTMLElement>(
          `[data-tour="${CSS.escape(step.target)}"]`,
        );
        if (!el) return;
        const r = el.getBoundingClientRect();
        const mid = r.top + r.height / 2;
        const d = Math.abs(mid - cy);
        if (d < bestD && r.bottom > 60 && r.top < window.innerHeight - 60) {
          bestD = d;
          best = n;
        }
      });

      // Today's Five and Customize share a card, so center-distance can't
      // separate them — force order: Five until scrolled a bit further in.
      const fiveIdx = tourSteps.findIndex((s) => s.target === 'five');
      const custIdx = tourSteps.findIndex((s) => s.target === 'customize');
      if (fiveIdx !== -1 && custIdx !== -1 && (best === fiveIdx || best === custIdx)) {
        const fiveEl = document.querySelector<HTMLElement>('[data-tour="five"]');
        if (fiveEl) {
          const fr = fiveEl.getBoundingClientRect();
          const inFiveCard = fr.bottom > 80 && fr.top < window.innerHeight * 0.7;
          if (inFiveCard) {
            best = fr.top > window.innerHeight * 0.22 ? fiveIdx : custIdx;
          }
        }
      }

      if (best === -1) {
        hideCoach();
        return;
      }

      if (best !== currentRef.current) {
        currentRef.current = best;
        setPipIndex(best);
        hideCoach(); // hide during the move
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          if (!endedRef.current) placeCoach(tourSteps[best]);
        }, 180);
      } else {
        if (settleTimer.current) clearTimeout(settleTimer.current);
        settleTimer.current = setTimeout(() => {
          if (!endedRef.current) placeCoach(tourSteps[best]);
        }, 120);
      }
    };

    // Scroll-snap as a progressive enhancement: opt each resolved target into
    // snapping at runtime so the live home settles on sections without editing
    // every section's static CSS.
    const root = document.documentElement;
    const prevSnapType = root.style.scrollSnapType;
    root.style.scrollSnapType = 'y proximity';
    const snapped: HTMLElement[] = [];
    activeSteps.forEach((step) => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(step.target)}"]`);
      if (el) {
        el.style.scrollSnapAlign = 'center';
        el.style.scrollMarginTop = '72px';
        snapped.push(el);
      }
    });

    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        evaluate();
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    const initial = setTimeout(evaluate, 200);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
      if (settleTimer.current) clearTimeout(settleTimer.current);
      clearTimeout(initial);
      root.style.scrollSnapType = prevSnapType;
      snapped.forEach((el) => {
        el.style.scrollSnapAlign = '';
        el.style.scrollMarginTop = '';
        el.classList.remove('welcome-tour-lit');
      });
    };
  }, [inactive, isClient, closerSlotId, markSeen, activeSteps]);

  if (inactive || !isClient) return null;

  const header = (
    <div className="welcome-tour-header" data-shrunk={shrunk} ref={headerRef}>
      <div className="wt-inner">
        <div className="wt-big px-5 pt-6 pb-5">
          <button
            type="button"
            onClick={handleClose}
            className="absolute top-5 right-4 rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-[0.06em] uppercase"
            style={{
              color: 'color-mix(in srgb, var(--primary-foreground) 82%, transparent)',
              background: 'color-mix(in srgb, var(--primary-foreground) 12%, transparent)',
            }}
          >
            Skip
          </button>
          <p
            className="text-[12px] font-bold tracking-[0.2em] uppercase"
            style={{ color: 'var(--brand-cream)' }}
          >
            {copy.header.eyebrow}
          </p>
          <h1 className="mt-1.5 font-serif text-3xl leading-[1.05] font-semibold">
            {copy.header.title}
          </h1>
          <p
            className="mt-2 text-[0.98rem]"
            style={{ color: 'color-mix(in srgb, var(--primary-foreground) 82%, transparent)' }}
          >
            {copy.header.body}
          </p>
        </div>
        <div className="wt-bar px-4">
          <span
            className="text-[13px] font-bold tracking-[0.1em] uppercase"
            style={{ color: 'var(--brand-cream)' }}
          >
            {copy.barLabel}
          </span>
          <div className="welcome-tour-pips" aria-hidden="true">
            {activeSteps.map((step, n) => (
              <i key={step.target} className={n <= pipIndex ? 'on' : ''} />
            ))}
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full px-4 py-1.5 text-[13px] font-semibold tracking-[0.06em] uppercase"
            style={{
              color: 'color-mix(in srgb, var(--primary-foreground) 82%, transparent)',
              background: 'color-mix(in srgb, var(--primary-foreground) 12%, transparent)',
            }}
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );

  const coach = (
    <div className="welcome-tour-coach" ref={coachRef} role="status" aria-live="polite">
      <div
        className="relative rounded-xl px-4 py-3"
        style={{
          background: 'var(--brand-ink-950)',
          color: 'var(--primary-foreground)',
          boxShadow: '0 16px 40px -16px color-mix(in srgb, var(--brand-ink) 55%, transparent)',
        }}
      >
        <span className="welcome-tour-arrow" ref={arrowRef} aria-hidden="true" />
        <p
          ref={coachLabelRef}
          className="mb-1 text-[11px] font-bold tracking-[0.1em] uppercase"
          style={{ color: 'var(--brand-cream)' }}
        />
        <p ref={coachCopyRef} className="text-[0.95rem] leading-[1.4]" />
      </div>
    </div>
  );

  const closer = (
    <section
      className="flex min-h-[70vh] flex-col justify-center px-6 pt-16"
      style={{
        background: 'var(--brand-ink-950)',
        color: 'var(--primary-foreground)',
        // Clear the app's fixed bottom nav so the CTA is never hidden behind it.
        paddingBottom: 'calc(7rem + env(safe-area-inset-bottom))',
      }}
    >
      <p
        className="text-[13px] font-semibold tracking-[0.14em] uppercase"
        style={{ color: 'var(--brand-cream)' }}
      >
        {copy.closer.eyebrow}
      </p>
      <h2 className="mt-2 font-serif text-5xl leading-[1.02] font-semibold">
        {copy.closer.title}
      </h2>
      <p
        className="mt-3.5 text-[1.15rem] leading-relaxed"
        style={{ color: 'color-mix(in srgb, var(--primary-foreground) 85%, transparent)' }}
      >
        {copy.closer.body}
      </p>
      <button
        type="button"
        onClick={handlePlay}
        className="mt-7 w-full rounded-xl py-4 text-[1.25rem] font-bold tracking-[0.03em] transition-transform active:scale-[0.98]"
        style={{
          background: 'var(--brand-orange)',
          color: 'var(--primary-foreground)',
          boxShadow: '0 14px 30px -12px color-mix(in srgb, var(--brand-orange) 70%, transparent)',
        }}
      >
        {copy.closer.cta}
      </button>
    </section>
  );

  const headerSlot = document.getElementById(headerSlotId);
  const closerSlot = document.getElementById(closerSlotId);

  return (
    <>
      <style>{SCOPED_STYLE}</style>
      {/* Header rides an in-flow slot at the top of the page so it pushes
          content and collapses to a sticky bar — no body-padding hack. The
          coach is viewport-fixed (portaled to body); the closer sits in its
          own slot at the bottom of the page flow. */}
      {headerSlot ? createPortal(header, headerSlot) : null}
      {createPortal(coach, document.body)}
      {closerSlot ? createPortal(closer, closerSlot) : null}
    </>
  );
}
