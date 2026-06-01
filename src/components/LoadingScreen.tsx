'use client';

import * as React from 'react';

type LoadingScreenProps = {
  label?: string;
  className?: string;
  fullScreen?: boolean;
};

const VIEWBOX_W = 400;
const VIEWBOX_H = 900;
const SIZE = 56;
const TRI_H = SIZE * 0.8660254;

const PALETTE = [
  '#1F3556',
  '#BC4632',
  '#5D7E96',
  '#D9A441',
  '#E8DCC0',
  '#F4ECD8',
  '#3A5973',
  '#A03A2C',
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
  breatheDelay: number;
  breatheDuration: number;
  swapDelay: number;
  swapDuration: number;
  opacityLow: number;
  opacityHigh: number;
};

function buildTriangles(): Tri[] {
  const tris: Tri[] = [];
  const rows = Math.ceil(VIEWBOX_H / TRI_H) + 2;
  const trisPerRow = Math.ceil((VIEWBOX_W * 2) / SIZE) + 4;

  let idx = 0;
  for (let row = -1; row < rows; row++) {
    for (let i = -2; i < trisPerRow; i++) {
      const y = row * TRI_H;
      const xBase = (i * SIZE) / 2;
      let points: string;

      if (((i % 2) + 2) % 2 === 0) {
        points = `${xBase},${y + TRI_H} ${xBase + SIZE},${y + TRI_H} ${xBase + SIZE / 2},${y}`;
      } else {
        points = `${xBase},${y} ${xBase + SIZE},${y} ${xBase + SIZE / 2},${y + TRI_H}`;
      }

      const r1 = rand(idx * 7 + 11);
      const r2 = rand(idx * 13 + 29);
      const r3 = rand(idx * 17 + 53);
      const r4 = rand(idx * 23 + 71);
      const r5 = rand(idx * 29 + 97);

      const colorAIdx = Math.floor(r1 * PALETTE.length);
      let colorBIdx = Math.floor(r4 * PALETTE.length);
      if (colorBIdx === colorAIdx) colorBIdx = (colorBIdx + 1) % PALETTE.length;

      const breatheDuration = 5 + r2 * 4;
      const breatheDelay = -r3 * breatheDuration;
      const swapDuration = 10 + r5 * 6;
      const swapDelay = -r1 * swapDuration;
      const opacityLow = 0.55 + r1 * 0.2;
      const opacityHigh = 0.95 + r2 * 0.05;

      tris.push({
        points,
        colorA: PALETTE[colorAIdx],
        colorB: PALETTE[colorBIdx],
        breatheDelay,
        breatheDuration,
        swapDelay,
        swapDuration,
        opacityLow,
        opacityHigh,
      });
      idx++;
    }
  }
  return tris;
}

type FloatTri = {
  points: string;
  color: string;
  cx: number;
  cy: number;
  dx: number;
  dy: number;
  dr: number;
  ds: number;
  duration: number;
  delay: number;
  opacity: number;
};

function buildFloaters(): FloatTri[] {
  const specs: Array<[number, number, number, string, number]> = [
    [80, 180, 110, '#BC4632', 0.5],
    [310, 240, 140, '#1F3556', 0.45],
    [60, 540, 130, '#D9A441', 0.45],
    [340, 650, 100, '#5D7E96', 0.5],
    [200, 380, 160, '#3A5973', 0.35],
    [160, 780, 90, '#A03A2C', 0.45],
    [40, 80, 120, '#5D7E96', 0.4],
    [360, 420, 110, '#D9A441', 0.5],
    [220, 120, 80, '#A03A2C', 0.5],
    [120, 320, 100, '#1F3556', 0.4],
    [280, 560, 130, '#BC4632', 0.35],
    [80, 720, 110, '#3A5973', 0.4],
  ];

  return specs.map(([cx, cy, size, color, opacity], i) => {
    const h = size * 0.8660254;
    const points = [
      [cx - size / 2, cy + h / 2],
      [cx + size / 2, cy + h / 2],
      [cx, cy - h / 2],
    ]
      .map(([x, y]) => `${x},${y}`)
      .join(' ');
    const seed = i + 1;
    const dx = (rand(seed * 31) - 0.5) * 100;
    const dy = (rand(seed * 47) - 0.5) * 100;
    const dr = (rand(seed * 59) - 0.5) * 40;
    const ds = 1 + rand(seed * 67) * 0.1;
    const duration = 16 + rand(seed * 71) * 10;
    const delay = -rand(seed * 89) * duration;

    return { points, color, cx, cy, dx, dy, dr, ds, duration, delay, opacity };
  });
}

export default function LoadingScreen({
  label = 'Loading',
  className,
  fullScreen = false,
}: LoadingScreenProps) {
  const triangles = React.useMemo(() => buildTriangles(), []);
  const floaters = React.useMemo(() => buildFloaters(), []);

  const wrapperClass = [
    'isolate flex items-center justify-center overflow-hidden bg-[#E8DCC0]',
    fullScreen ? 'fixed inset-0 z-[60]' : 'relative h-full w-full min-h-[480px]',
    className ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={wrapperClass}
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={`${label}…`}
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
                  fill: 'var(--tri-color-a)',
                  animation: `triangle-breathe ${t.breatheDuration}s ease-in-out ${t.breatheDelay}s infinite, triangle-color-swap ${t.swapDuration}s steps(1, end) ${t.swapDelay}s infinite`,
                  ['--tri-color-a' as string]: t.colorA,
                  ['--tri-color-b' as string]: t.colorB,
                  ['--tri-opacity-low' as string]: String(t.opacityLow),
                  ['--tri-opacity-high' as string]: String(t.opacityHigh),
                } as React.CSSProperties
              }
            />
          ))}
        </g>

        <g style={{ mixBlendMode: 'multiply' }}>
          {floaters.map((f, i) => (
            <g
              key={i}
              className="triangle-loader-float"
              style={
                {
                  transformBox: 'fill-box',
                  transformOrigin: `${f.cx}px ${f.cy}px`,
                  animation: `triangle-drift ${f.duration}s ease-in-out ${f.delay}s infinite`,
                  ['--tri-dx' as string]: `${f.dx}px`,
                  ['--tri-dy' as string]: `${f.dy}px`,
                  ['--tri-dr' as string]: `${f.dr}deg`,
                  ['--tri-ds' as string]: String(f.ds),
                } as React.CSSProperties
              }
            >
              <polygon points={f.points} fill={f.color} opacity={f.opacity} />
            </g>
          ))}
        </g>
      </svg>

      <div
        className="triangle-loader-sweep pointer-events-none absolute -inset-x-1/2 top-1/2 h-[60vh]"
        aria-hidden="true"
      />

      <div className="relative z-10 mx-6 flex w-full max-w-xs flex-col items-center rounded-2xl bg-[#F5EBD3] px-8 py-10 shadow-[0_8px_24px_rgba(20,18,8,0.18)] ring-1 ring-black/5">
        <p
          className="text-3xl font-black tracking-[0.18em] text-[#1a1208]"
          style={{ fontFamily: 'var(--font-literata, Georgia), serif' }}
        >
          JOSHING
        </p>
        <div className="mt-6 h-px w-12 bg-[#1a1208]/20" aria-hidden="true" />
        <p className="mt-5 flex items-baseline gap-1 text-sm font-medium tracking-wider text-[#1a1208]/70 uppercase">
          <span>{label}</span>
          <span className="ml-0.5 inline-flex gap-0.5" aria-hidden="true">
            <span
              className="triangle-loader-dot inline-block"
              style={{ animation: 'loading-dot 1.2s ease-in-out 0s infinite' }}
            >
              .
            </span>
            <span
              className="triangle-loader-dot inline-block"
              style={{ animation: 'loading-dot 1.2s ease-in-out 0.2s infinite' }}
            >
              .
            </span>
            <span
              className="triangle-loader-dot inline-block"
              style={{ animation: 'loading-dot 1.2s ease-in-out 0.4s infinite' }}
            >
              .
            </span>
          </span>
        </p>
      </div>
    </div>
  );
}

export { LoadingScreen };
