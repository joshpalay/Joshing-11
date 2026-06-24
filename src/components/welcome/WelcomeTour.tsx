'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';

/**
 * Welcome tour — a first-run guided spotlight over the REAL, live home.
 *
 * Ported from the `welcome-coachmarks` spotlight prototype. It takes over the
 * screen as a fixed overlay, dims the page, and spotlights one real section at a
 * time (located via `data-tour="<id>"`). An invisible scroll driver advances
 * through the steps; the home softly pans so each target settles ~40% down, a
 * white tooltip hugs it, and a closing "Play my Five" bar drops the player
 * straight into the round.
 *
 * The dim + cutout is drawn by a spotlight BOX positioned at the target's
 * computed rect (transparent interior + a huge box-shadow), not by raising the
 * real element — so panning `main` (which creates a stacking context) can't trap
 * the highlight under the scrim. The global app chrome (top bar / bottom tabs /
 * FAB, tagged `data-app-chrome`) is hidden while the tour runs.
 *
 * Anchoring is best-effort: steps whose target isn't on the page are skipped
 * (the live home carries some anchors today; the dev preview carries all five).
 * Activation/suppression is client-side: the live home mounts this on
 * `?welcome=1` and a localStorage flag suppresses re-runs. `forced` bypasses —
 * and never writes — that flag for the dev replay.
 */

export type WelcomeTourStep = {
  /** Matches a `data-tour="<target>"` attribute on the page. */
  target: string;
  /** Small-caps eyebrow above the callout copy. */
  label: string;
  /** Callout body. May contain simple <b> emphasis (trusted, static copy). */
  copy: string;
};

export const WELCOME_TOUR_STORAGE_KEY = 'joshing.welcomeTourSeenAt';

// Canonical five callouts (build brief). Order matters: Today's Five fires
// before Customize even though Customize lives inside the Five card.
export const DEFAULT_WELCOME_TOUR_STEPS: WelcomeTourStep[] = [
  {
    target: 'five',
    label: "Today's Five",
    copy: 'Your five questions for the day show up <b>right here</b> — tap Play to start. A new set lands every afternoon.',
  },
  {
    target: 'customize',
    label: 'Customize',
    copy: "Want different topics, or harder questions? <b>Change them anytime</b> — it's right here.",
  },
  {
    target: 'foryou',
    label: 'For You',
    copy: "Questions a friend sends or writes <b>just for you</b> land here. Answer back and they'll see how you did.",
  },
  {
    target: 'friends',
    label: 'From Friends',
    copy: 'Questions your friends have aced this week. <b>Jump in on the same ones</b> and see how you stack up.',
  },
  {
    target: 'shared',
    label: 'Shared Ground',
    copy: 'Where you and your friends overlap — and where to <b>find more people</b> to play with.',
  },
];

type WelcomeTourCopy = {
  stripLabel: string;
  scrollHint: string;
  playCta: string;
};

const DEFAULT_COPY: WelcomeTourCopy = {
  stripLabel: 'Welcome — a quick tour',
  scrollHint: 'Scroll to move through ↓',
  playCta: 'Play my Five →',
};

type WelcomeTourProps = {
  steps?: WelcomeTourStep[];
  copy?: Partial<WelcomeTourCopy>;
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

// Client-only readiness without a setState-in-effect: false during SSR, true
// once hydrated.
const subscribeNoop = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/** Clears the persisted seen-flag so the live tour can re-arm (dev affordance). */
export function clearWelcomeTourSeen(storageKey: string = WELCOME_TOUR_STORAGE_KEY): void {
  try {
    window.localStorage.removeItem(storageKey);
  } catch {
    // localStorage can be unavailable (private mode) — nothing to clear.
  }
}

const PAN_EASE = 'cubic-bezier(.25,.7,.25,1)';

const SCOPED_STYLE = `
html.welcome-tour-active{overflow:hidden;}
html.welcome-tour-active [data-app-chrome]{display:none !important;}
.welcome-tour-strip{position:fixed;top:0;left:0;right:0;z-index:50;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--brand-ink-950);color:var(--primary-foreground);padding:9px 16px;}
.welcome-tour-strip .wt-wm{font-size:12px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:var(--brand-cream);}
.welcome-tour-strip .wt-skip{font-size:12px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:color-mix(in srgb, var(--primary-foreground) 82%, transparent);background:color-mix(in srgb, var(--primary-foreground) 12%, transparent);border:none;border-radius:999px;padding:6px 13px;cursor:pointer;}
.welcome-tour-pips{display:flex;gap:5px;}
.welcome-tour-pips i{width:6px;height:6px;border-radius:50%;background:color-mix(in srgb, var(--primary-foreground) 28%, transparent);transition:background .3s;}
.welcome-tour-pips i.on{background:var(--brand-orange);}
.welcome-tour-spot{position:fixed;z-index:20;border-radius:13px;pointer-events:none;opacity:0;box-shadow:0 0 0 3px var(--brand-orange), 0 0 0 4000px color-mix(in srgb, var(--brand-ink-950) 66%, transparent);transition:opacity .4s ease, top .6s ${PAN_EASE}, left .6s ${PAN_EASE}, width .4s ease, height .4s ease;}
.welcome-tour-spot.show{opacity:1;}
.welcome-tour-help{position:fixed;z-index:45;width:248px;opacity:0;pointer-events:none;transition:opacity .35s ease, top .55s ${PAN_EASE}, left .35s ease;}
.welcome-tour-help.show{opacity:1;}
.welcome-tour-help .wt-box{background:var(--brand-card);color:var(--brand-ink);border-radius:12px;padding:13px 15px;box-shadow:0 16px 40px -14px color-mix(in srgb, var(--brand-ink-950) 55%, transparent);position:relative;}
.welcome-tour-help .wt-k{font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--brand-orange);margin-bottom:4px;}
.welcome-tour-help .wt-p{font-size:.97rem;line-height:1.4;color:var(--brand-ink-700);}
.welcome-tour-help .wt-p b{color:var(--brand-ink);font-weight:600;}
.welcome-tour-help .wt-arrow{position:absolute;width:0;height:0;}
.welcome-tour-help.below .wt-arrow{top:-8px;border-left:9px solid transparent;border-right:9px solid transparent;border-bottom:9px solid var(--brand-card);}
.welcome-tour-help.above .wt-arrow{bottom:-8px;border-left:9px solid transparent;border-right:9px solid transparent;border-top:9px solid var(--brand-card);}
.welcome-tour-hint{position:fixed;bottom:18px;left:0;right:0;z-index:45;text-align:center;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--primary-foreground);text-shadow:0 1px 8px color-mix(in srgb, var(--brand-ink-950) 50%, transparent);animation:welcomeTourBob 1.8s ease-in-out infinite;pointer-events:none;}
@keyframes welcomeTourBob{0%,100%{transform:translateY(0);}50%{transform:translateY(5px);}}
.welcome-tour-endbar{position:fixed;bottom:0;left:0;right:0;z-index:55;padding:16px 20px calc(22px + env(safe-area-inset-bottom));background:linear-gradient(0deg, var(--brand-ink-950) 70%, color-mix(in srgb, var(--brand-ink-950) 0%, transparent));}
.welcome-tour-endbar .wt-play{width:100%;display:flex;align-items:center;justify-content:center;gap:9px;background:var(--brand-orange);color:var(--primary-foreground);font-size:1.2rem;font-weight:700;letter-spacing:.03em;border:none;border-radius:13px;padding:17px;cursor:pointer;}
.welcome-tour-driver{position:fixed;inset:0;z-index:40;overflow-y:scroll;scrollbar-width:none;-webkit-overflow-scrolling:touch;}
.welcome-tour-driver::-webkit-scrollbar{display:none;}
@media (prefers-reduced-motion:reduce){.welcome-tour-spot,.welcome-tour-help,.welcome-tour-hint{transition:none;animation:none;}}
`;

export default function WelcomeTour({
  steps = DEFAULT_WELCOME_TOUR_STEPS,
  copy: copyOverride,
  forced = false,
  storageKey = WELCOME_TOUR_STORAGE_KEY,
  playHref = '/daily',
  onPlay,
  onClose,
}: WelcomeTourProps) {
  const router = useRouter();
  const copy: WelcomeTourCopy = { ...DEFAULT_COPY, ...copyOverride };

  const isClient = useSyncExternalStore(subscribeNoop, getClientSnapshot, getServerSnapshot);
  const [closed, setClosed] = useState(false);
  // Current step index (drives pips, hint, end bar). -1 before the first place.
  const [stepIndex, setStepIndex] = useState(-1);

  const spotRef = useRef<HTMLDivElement | null>(null);
  const helpRef = useRef<HTMLDivElement | null>(null);
  const helpKRef = useRef<HTMLParagraphElement | null>(null);
  const helpPRef = useRef<HTMLParagraphElement | null>(null);
  const arrowRef = useRef<HTMLSpanElement | null>(null);
  const driverRef = useRef<HTMLDivElement | null>(null);

  const currentRef = useRef(-1);
  const panRef = useRef(0);
  const endedRef = useRef(false);

  // Seen-flag (external state) read the lint-sanctioned way.
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

  // Stable signature of which step targets are present in the DOM.
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
  const activeSteps = useMemo(() => {
    const resolved = steps.filter((_, index) => presenceKey[index] === '1');
    return resolved.length > 0 ? resolved : steps;
  }, [steps, presenceKey]);

  const inactive = closed || seen;
  const lastIndex = activeSteps.length - 1;

  // Core engine: hide app chrome, lock scroll, and drive the spotlight + pan
  // from the invisible scroll driver. Mutates the overlay via refs so scroll
  // stays cheap; React state only carries the step index.
  useEffect(() => {
    if (inactive || !isClient) return;

    const root = document.documentElement;
    const main = document.querySelector('main');
    const tourSteps = activeSteps;

    const markSeen = () => {
      if (forced) return;
      try {
        window.localStorage.setItem(storageKey, new Date().toISOString());
      } catch {
        // best-effort
      }
    };

    const PAD = 8;
    // The settled geometry of the active target (viewport coords), shared
    // between the spotlight (placed immediately) and the tooltip (placed after
    // the pan settles).
    const geom = { top: 0, left: 0, width: 0, height: 0 };

    // Pan the home and glide the spotlight to the target. Because the only
    // transform is translateY on `main`, the target's settled rect is its
    // current rect shifted by the pan delta — exact, so no mid-pan measurement.
    const placeSpotlight = (n: number): boolean => {
      const step = tourSteps[n];
      const el = document.querySelector<HTMLElement>(`[data-tour="${CSS.escape(step.target)}"]`);
      const spot = spotRef.current;
      if (!el || !spot) return false;
      const r = el.getBoundingClientRect();
      // Soft pan: move the home so the target settles ~40% down; never past top.
      const want = window.innerHeight * 0.4;
      const drift = r.top - want;
      const newPan = Math.min(0, panRef.current - drift);
      const delta = newPan - panRef.current;
      panRef.current = newPan;
      if (main) main.style.transform = `translateY(${newPan}px)`;

      geom.top = r.top + delta;
      geom.left = r.left;
      geom.width = r.width;
      geom.height = r.height;

      spot.style.top = `${geom.top - PAD}px`;
      spot.style.left = `${geom.left - PAD}px`;
      spot.style.width = `${geom.width + PAD * 2}px`;
      spot.style.height = `${geom.height + PAD * 2}px`;
      spot.classList.add('show');
      return true;
    };

    // After the pan settles, hug the target with the tooltip — flips above/below
    // by room, clamps to the screen edges, aims the arrow at the target center.
    const placeHelp = (n: number) => {
      const step = tourSteps[n];
      const help = helpRef.current;
      if (!help || !helpKRef.current || !helpPRef.current || !arrowRef.current) return;
      helpKRef.current.textContent = step.label;
      helpPRef.current.innerHTML = step.copy;
      const hw = Math.min(248, window.innerWidth - 28);
      help.style.width = `${hw}px`;
      help.style.visibility = 'hidden';
      help.classList.add('show');
      const hh = help.offsetHeight;
      const below = geom.top < window.innerHeight * 0.5;
      const top = below ? geom.top + geom.height + PAD + 12 : geom.top - hh - 12;
      let left = geom.left + geom.width / 2 - hw / 2;
      left = Math.max(10, Math.min(left, window.innerWidth - hw - 10));
      help.classList.toggle('below', below);
      help.classList.toggle('above', !below);
      help.style.left = `${left}px`;
      help.style.top = `${top}px`;
      help.style.visibility = 'visible';
      let ax = geom.left + geom.width / 2 - left - 9;
      ax = Math.max(14, Math.min(ax, hw - 26));
      arrowRef.current.style.left = `${ax}px`;
    };

    let dwellTimer: ReturnType<typeof setTimeout> | null = null;
    const goToStep = (n: number) => {
      if (n === currentRef.current) return;
      currentRef.current = n;
      setStepIndex(n);
      if (n === lastIndex) markSeen();
      // Hide the tooltip while the page pans; glide the spotlight to the target
      // immediately, then let the tooltip re-appear once the pan has settled
      // (dwell), so its placement lands on the target's final position.
      helpRef.current?.classList.remove('show');
      const placed = placeSpotlight(n);
      if (dwellTimer) clearTimeout(dwellTimer);
      if (placed) {
        dwellTimer = setTimeout(() => {
          if (!endedRef.current) placeHelp(n);
        }, 280);
      }
    };

    // Hide app chrome + lock the page; the driver owns scrolling.
    root.classList.add('welcome-tour-active');
    if (main) {
      main.style.transition = `transform .6s ${PAN_EASE}`;
      main.style.willChange = 'transform';
    }

    const driver = driverRef.current;
    const onDrive = () => {
      if (endedRef.current || !driver) return;
      const max = driver.scrollHeight - driver.clientHeight;
      const p = max > 0 ? Math.min(1, Math.max(0, driver.scrollTop / max)) : 0;
      goToStep(Math.min(lastIndex, Math.floor(p * tourSteps.length * 0.999)));
    };
    driver?.addEventListener('scroll', onDrive, { passive: true });
    const initial = window.setTimeout(() => goToStep(0), 250);
    const onResize = () => {
      const n = currentRef.current;
      if (n >= 0 && placeSpotlight(n)) placeHelp(n);
    };
    window.addEventListener('resize', onResize);

    return () => {
      driver?.removeEventListener('scroll', onDrive);
      window.removeEventListener('resize', onResize);
      clearTimeout(initial);
      if (dwellTimer) clearTimeout(dwellTimer);
      root.classList.remove('welcome-tour-active');
      if (main) {
        main.style.transform = '';
        main.style.transition = '';
        main.style.willChange = '';
      }
    };
  }, [inactive, isClient, activeSteps, lastIndex, forced, storageKey]);

  if (inactive || !isClient) return null;

  const overlay = (
    <>
      <style>{SCOPED_STYLE}</style>

      <div className="welcome-tour-strip">
        <span className="wt-wm">{copy.stripLabel}</span>
        <div className="welcome-tour-pips" aria-hidden="true">
          {activeSteps.map((step, n) => (
            <i key={step.target} className={n <= stepIndex ? 'on' : ''} />
          ))}
        </div>
        <button
          type="button"
          className="wt-skip"
          onClick={() => {
            endedRef.current = true;
            if (!forced) {
              try {
                window.localStorage.setItem(storageKey, new Date().toISOString());
              } catch {
                // best-effort
              }
            }
            setClosed(true);
            if (onClose) {
              onClose();
            } else if (!forced) {
              router.replace(window.location.pathname);
            }
          }}
        >
          Skip
        </button>
      </div>

      <div className="welcome-tour-spot" ref={spotRef} aria-hidden="true" />

      <div className="welcome-tour-help" ref={helpRef} role="status" aria-live="polite">
        <div className="wt-box">
          <span className="wt-arrow" ref={arrowRef} aria-hidden="true" />
          <p className="wt-k" ref={helpKRef} />
          <p className="wt-p" ref={helpPRef} />
        </div>
      </div>

      {stepIndex < lastIndex ? (
        <div className="welcome-tour-hint" aria-hidden="true">
          {copy.scrollHint}
        </div>
      ) : null}

      {stepIndex >= lastIndex ? (
        <div className="welcome-tour-endbar">
          <button
            type="button"
            className="wt-play"
            onClick={() => {
              if (!forced) {
                try {
                  window.localStorage.setItem(storageKey, new Date().toISOString());
                } catch {
                  // best-effort
                }
              }
              if (onPlay) {
                onPlay();
              } else {
                router.push(playHref);
              }
            }}
          >
            {copy.playCta}
          </button>
        </div>
      ) : null}

      {/* Invisible scroll driver — captures scroll to advance steps. Tall enough
          to give each step ~two screenfuls of travel, so a normal scroll flick
          doesn't blow past a group. */}
      <div className="welcome-tour-driver" ref={driverRef}>
        <div style={{ height: `${Math.max(activeSteps.length, 1) * 200}vh` }} />
      </div>
    </>
  );

  return createPortal(overlay, document.body);
}
