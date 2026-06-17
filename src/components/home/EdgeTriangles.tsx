import type { CSSProperties } from 'react'

/**
 * Decorative brand triangles that peek out from the left/right page edges down
 * the homepage, roughly every ~230–260px. A deliberately sparse accent — not a
 * full background — so the content stays calm and readable (replaced the busy
 * tiled pattern + cream scrim).
 *
 * Pure CSS shapes (clip-path) filled with the on-system triangle palette tokens,
 * so they stay crisp at any size and add no image weight or off-system color.
 * The layer is aria-hidden, non-interactive, and clipped to the page edges, so
 * the triangles read as emerging from the side. Sits behind the content (-z-10).
 *
 * Triangles past the live page height are clipped away by the layer's
 * overflow-hidden, so the list can safely over-provision for a long feed.
 */

type Side = 'left' | 'right'
type TriColor =
  | 'orange'
  | 'darkteal'
  | 'lightteal'
  | 'darkyellow'
  | 'lighttan'
  | 'amber'

type EdgeTriangle = {
  top: number
  side: Side
  size: number
  color: TriColor
}

// Alternating sides and colors down the page; an occasional smaller second
// triangle near a larger one gives the "occasional pair" rhythm.
const TRIANGLES: EdgeTriangle[] = [
  { top: 150, side: 'right', size: 72, color: 'orange' },
  { top: 320, side: 'left', size: 58, color: 'darkteal' },
  { top: 380, side: 'left', size: 30, color: 'darkyellow' },
  { top: 600, side: 'right', size: 70, color: 'amber' },
  { top: 660, side: 'right', size: 32, color: 'lighttan' },
  { top: 850, side: 'left', size: 60, color: 'lightteal' },
  { top: 1080, side: 'right', size: 64, color: 'orange' },
  { top: 1130, side: 'right', size: 28, color: 'darkyellow' },
  { top: 1320, side: 'left', size: 56, color: 'amber' },
  { top: 1560, side: 'right', size: 66, color: 'darkteal' },
  { top: 1800, side: 'left', size: 58, color: 'orange' },
  { top: 2040, side: 'right', size: 62, color: 'amber' },
]

// Base sits on the page edge, apex points inward; shifted off-edge by ~40% of
// its size so the shape reads as cut by the edge ("sticking out of the side").
const CLIP: Record<Side, string> = {
  left: 'polygon(0 0, 0 100%, 100% 50%)',
  right: 'polygon(100% 0, 100% 100%, 0 50%)',
}

// Procedural grain that mirrors the speckled paper texture on the source
// triangles. A tileable fractal-noise field, desaturated and compressed into a
// mostly-light band so that — blended `multiply` over the flat --tri-* color —
// it only darkens in faint specks rather than muddying the whole fill. Tune the
// `intercept`/`slope` pair for grain strength: a lower intercept = stronger
// grain (more darkening); slope sets the speck contrast.
const GRAIN_SVG = `<svg xmlns='http://www.w3.org/2000/svg' width='90' height='90'><filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix type='saturate' values='0'/><feComponentTransfer><feFuncR type='linear' slope='0.18' intercept='0.82'/><feFuncG type='linear' slope='0.18' intercept='0.82'/><feFuncB type='linear' slope='0.18' intercept='0.82'/></feComponentTransfer></filter><rect width='100%' height='100%' filter='url(#g)'/></svg>`
const GRAIN_URL = `url("data:image/svg+xml,${encodeURIComponent(GRAIN_SVG)}")`

export function EdgeTriangles() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {TRIANGLES.map((t, i) => {
        const protrude = Math.round(t.size * 0.4)
        const style: CSSProperties = {
          top: t.top,
          width: t.size,
          height: t.size,
          backgroundColor: `var(--tri-${t.color})`,
          // Grain texture multiplied over the flat color, then both clipped to
          // the triangle — matches the speckled source artwork.
          backgroundImage: GRAIN_URL,
          backgroundBlendMode: 'multiply',
          backgroundRepeat: 'repeat',
          backgroundSize: '90px 90px',
          clipPath: CLIP[t.side],
          ...(t.side === 'left' ? { left: -protrude } : { right: -protrude }),
        }
        return <span key={i} className="absolute block" style={style} />
      })}
    </div>
  )
}

export default EdgeTriangles
