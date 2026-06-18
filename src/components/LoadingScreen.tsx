"use client";

import * as React from "react";

import { usePrefersReducedMotion } from "@/components/feed/usePrefersReducedMotion";

type LoadingScreenProps = {
  /** A single fixed message. Renders statically with the animated dots. */
  label?: string;
  /** A set of phrases to rotate through, each fading in and out. */
  messages?: string[];
  className?: string;
  fullScreen?: boolean;
};

// The default rotating copy — evocative of what's happening behind the curtain
// rather than a bare "Loading". Shown when neither `label` nor `messages` is
// passed (e.g. the game/route-level loading fallbacks).
const DEFAULT_MESSAGES = [
  "Crafting your bespoke questions",
  "Finding the right multitudes",
  "Reading the room",
  "Tuning the difficulty",
];

// How long each rotating phrase stays on screen — must match the
// `loading-message` keyframe duration in globals.css so the fade-out lands
// exactly as the next phrase mounts.
const MESSAGE_CYCLE_MS = 3200;

const VIEWBOX_W = 400;
const VIEWBOX_H = 900;
const SIZE = 56; // triangle base
const TRI_H = SIZE * 0.8660254; // equilateral row height

// The canonical JOSHING triangle palette, sampled directly from the Variant4
// brand artwork that backs the login + home surfaces (public/images/Variant4*).
// The loader was previously on a stale teal/tan palette with no sky-blue and a
// tan field, which made it read as a different design system. These six match
// the print art exactly. (Note: the shared --tri-* tokens in globals.css are
// also stale/blue-less — out of scope here, but worth reconciling later.)
const PALETTE = [
  "#F38058", // coral
  "#FFD07E", // gold
  "#9BC0CC", // sky blue (Variant4's signature; was missing entirely)
  "#8EA4A0", // sage
  "#CFD3C0", // light sage
  "#FFFFEA", // cream
];

function rand(seed: number) {
  let h = (seed * 2654435761) >>> 0;
  h = ((h ^ (h >>> 13)) * 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

type Tri = {
  points: string;
  colorA: string;
  colorB: string;
  cycleDelay: number;
  cycleDuration: number;
  opacityLow: number;
  opacityHigh: number;
};

function buildTriangles(): Tri[] {
  const tris: Tri[] = [];
  // Left/right equilateral grid — the Variant4 up/down tiling rotated 90°:
  // columns of width TRI_H, each column alternating left- and right-pointing
  // triangles that interlock on a SIZE/2 vertical step.
  const cols = Math.ceil(VIEWBOX_W / TRI_H) + 2;
  const rows = Math.ceil(VIEWBOX_H / (SIZE / 2)) + 4;

  let idx = 0;
  for (let col = -1; col < cols; col++) {
    const xLeft = col * TRI_H;
    const xRight = xLeft + TRI_H;
    for (let row = -1; row < rows; row++) {
      const cy = (row * SIZE) / 2;
      let points: string;

      if ((((row + col) % 2) + 2) % 2 === 0) {
        // right-pointing: base on the left edge, apex at the right
        points = `${xLeft},${cy - SIZE / 2} ${xLeft},${cy + SIZE / 2} ${xRight},${cy}`;
      } else {
        // left-pointing: base on the right edge, apex at the left
        points = `${xRight},${cy - SIZE / 2} ${xRight},${cy + SIZE / 2} ${xLeft},${cy}`;
      }

      const r1 = rand(idx * 7 + 11);
      const r2 = rand(idx * 13 + 29);
      const r3 = rand(idx * 17 + 53);
      const r4 = rand(idx * 23 + 71);

      const colorAIdx = Math.floor(r1 * PALETTE.length);
      let colorBIdx = Math.floor(r4 * PALETTE.length);
      if (colorBIdx === colorAIdx) colorBIdx = (colorBIdx + 1) % PALETTE.length;

      // One shared cycle drives both the fade and the color swap so each
      // triangle changes colour while it is faded out — a soft cross-fade
      // rather than a hard cut.
      const cycleDuration = 7 + r2 * 5;
      const cycleDelay = -r3 * cycleDuration;
      const opacityLow = 0.14 + r1 * 0.18;
      const opacityHigh = 0.9 + r2 * 0.1;

      tris.push({
        points,
        colorA: PALETTE[colorAIdx],
        colorB: PALETTE[colorBIdx],
        cycleDelay,
        cycleDuration,
        opacityLow,
        opacityHigh,
      });
      idx++;
    }
  }
  return tris;
}

export default function LoadingScreen({
  label,
  messages,
  className,
  fullScreen = false,
}: LoadingScreenProps) {
  const triangles = React.useMemo(() => buildTriangles(), []);
  const reducedMotion = usePrefersReducedMotion();

  // A caller-supplied `label` is a single fixed message; otherwise rotate
  // through `messages` (or the curated defaults). One item ⇒ no rotation.
  const rotation = React.useMemo(
    () => messages ?? (label != null ? [label] : DEFAULT_MESSAGES),
    [messages, label],
  );
  const rotating = rotation.length > 1 && !reducedMotion;

  const [index, setIndex] = React.useState(0);
  React.useEffect(() => {
    if (!rotating) return;
    const id = window.setInterval(() => {
      setIndex((i) => (i + 1) % rotation.length);
    }, MESSAGE_CYCLE_MS);
    return () => window.clearInterval(id);
  }, [rotating, rotation.length]);

  const current = rotation[Math.min(index, rotation.length - 1)] ?? rotation[0];

  const wrapperClass = [
    "isolate flex items-center justify-center overflow-hidden bg-[var(--brand-cream-page)]",
    fullScreen
      ? "fixed inset-0 z-[60]"
      : "relative h-full w-full min-h-[80vh]",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={wrapperClass}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={`${current}…`}
    >
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox={`0 0 ${VIEWBOX_W} ${VIEWBOX_H}`}
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        <g>
          {triangles.map((t, i) => (
            <polygon
              key={i}
              className="triangle-loader-tri"
              points={t.points}
              style={
                {
                  fill: "var(--tri-color-a)",
                  animation: `triangle-fade ${t.cycleDuration}s ease-in-out ${t.cycleDelay}s infinite, triangle-color-swap ${t.cycleDuration}s linear ${t.cycleDelay}s infinite`,
                  ["--tri-color-a" as string]: t.colorA,
                  ["--tri-color-b" as string]: t.colorB,
                  ["--tri-opacity-low" as string]: String(t.opacityLow),
                  ["--tri-opacity-high" as string]: String(t.opacityHigh),
                } as React.CSSProperties
              }
            />
          ))}
        </g>
      </svg>

      {/* Paper-grain overlay (Figma export) — matches the baked grain in the
          Variant4 artwork so the live SVG field shares its texture. Multiply
          blend over the triangles; degrades to nothing if the asset is absent. */}
      <div
        className="triangle-loader-grain pointer-events-none absolute inset-0"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-6 w-full max-w-sm rounded-[var(--radius-md)] bg-[var(--brand-cream-card)] px-12 py-7 text-center shadow-[0_4px_4px_0_rgba(0,0,0,0.25),0_4px_12px_0_rgba(40,32,30,0.04)] ring-1 ring-black/5">
        <p className="font-wordmark text-5xl font-bold leading-[52px] tracking-[4.8px] text-[var(--brand-ink-950)]">
          JOSHING
        </p>
        <div
          className="mx-auto mt-4 h-0.5 w-[60px] rounded-full bg-[var(--accent-gold)]"
          aria-hidden="true"
        />
        <p className="relative mx-auto mt-4 flex h-6 items-baseline justify-center font-sans text-sm font-normal tracking-wider uppercase text-[var(--warm-ink)]/75">
          {rotating ? (
            <span
              key={index}
              className="loading-message inline-flex items-baseline gap-1"
            >
              {current}
            </span>
          ) : (
            <span className="inline-flex items-baseline gap-1">
              <span>{current}</span>
              <span className="ml-0.5 inline-flex gap-0.5" aria-hidden="true">
                <span
                  className="triangle-loader-dot inline-block"
                  style={{ animation: "loading-dot 1.2s ease-in-out 0s infinite" }}
                >
                  .
                </span>
                <span
                  className="triangle-loader-dot inline-block"
                  style={{ animation: "loading-dot 1.2s ease-in-out 0.2s infinite" }}
                >
                  .
                </span>
                <span
                  className="triangle-loader-dot inline-block"
                  style={{ animation: "loading-dot 1.2s ease-in-out 0.4s infinite" }}
                >
                  .
                </span>
              </span>
            </span>
          )}
        </p>
      </div>
    </div>
  );
}

export { LoadingScreen };
