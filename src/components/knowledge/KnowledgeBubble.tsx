import type { CSSProperties, ReactNode } from 'react'

/**
 * Single source for the domain "bubble" gradient — a soft radial fill that
 * brightens the inner stop of a domain's `light` color. Three knowledge circle
 * renderers (KnowledgeCircle, DomainCircle, PortraitDomainCircle) previously
 * inlined this exact string, each repeating the fragile `.replace('0.12','0.22')`
 * that bumps the light token's 0.12 alpha to 0.22 for the highlight. (Design
 * audit C8 — consolidate the circle renderers behind one primitive.)
 */
export function domainBubbleGradient(light: string): string {
  return `radial-gradient(circle at 38% 38%, ${light.replace('0.12', '0.22')}, ${light})`
}

export type KnowledgeBubbleProps = {
  /** Circle diameter in px. */
  diameter: number
  /** Domain `light` color; builds the radial gradient unless `background` is set. */
  light?: string
  /** Explicit background override (ghost/declared fills that aren't a domain gradient). */
  background?: string
  opacity?: number
  border?: string
  /** Centered content — a domain icon, a mastery count, etc. */
  children?: ReactNode
  style?: CSSProperties
}

/**
 * The leaf circle every knowledge renderer draws: a round, gradient-filled disc
 * that optionally centers a child (icon/count) and carries a border or override
 * background. Sizing lives in `circle-sizing.ts`; color lives in the domain color
 * map — this just owns the shared shape + gradient math.
 */
export function KnowledgeBubble({
  diameter,
  light,
  background,
  opacity,
  border,
  children,
  style,
}: KnowledgeBubbleProps) {
  return (
    <div
      style={{
        width: diameter,
        height: diameter,
        borderRadius: '50%',
        background: background ?? (light ? domainBubbleGradient(light) : undefined),
        opacity,
        border,
        display: 'grid',
        placeItems: 'center',
        flexShrink: 0,
        ...style,
      }}
    >
      {children}
    </div>
  )
}
