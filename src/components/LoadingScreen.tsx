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
const SIZE = 56;
const TRI_H = SIZE * 0.8660254;

const PALETTE = [
  "#D15E36", // orange
  "#6D837F", // darkteal
  "#ADB19E", // lightteal
  "#F8E6C7", // cream
  "#DEAE5C", // darkyellow
  "#EDD2A3", // lighttan
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
  const cols = Math.ceil(VIEWBOX_W / TRI_H) + 2;
  const trisPerCol = Math.ceil((VIEWBOX_H * 2) / SIZE) + 4;

  let idx = 0;
  for (let col = -1; col < cols; col++) {
    for (let i = -2; i < trisPerCol; i++) {
      // Triangles point left/right (the up/down pattern rotated 90°): columns of
      // width TRI_H, with triangles offset by SIZE/2 down each column.
      const x = col * TRI_H;
      const yBase = (i * SIZE) / 2;
      let points: string;

      if (((i % 2) + 2) % 2 === 0) {
        points = `${x + TRI_H},${yBase} ${x + TRI_H},${yBase + SIZE} ${x},${yBase + SIZE / 2}`;
      } else {
        points = `${x},${yBase} ${x},${yBase + SIZE} ${x + TRI_H},${yBase + SIZE / 2}`;
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
    "isolate flex items-center justify-center overflow-hidden bg-[#E8DCC0]",
    fullScreen
      ? "fixed inset-0 z-[60]"
      : "relative h-full w-full min-h-[480px]",
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

      <div
        className="triangle-loader-sweep pointer-events-none absolute -inset-x-1/2 top-1/2 h-[60vh]"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-6 w-full max-w-sm rounded-[8px] bg-[var(--brand-cream-card)] px-[46px] py-7 text-center shadow-[0_4px_4px_0_rgba(0,0,0,0.25),0_4px_12px_0_rgba(40,32,30,0.04)] ring-1 ring-black/5">
        <p className="font-sans text-5xl font-bold leading-[52px] tracking-[4.8px] text-[var(--brand-ink-950)]">
          JOSHING
        </p>
        <div
          className="mx-auto mt-4 h-0.5 w-[60px] rounded-full bg-[var(--tri-amber)]"
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
