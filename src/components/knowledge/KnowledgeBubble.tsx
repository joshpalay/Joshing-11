import type { CSSProperties, ReactNode } from 'react'

/**
 * Single source for the domain "bubble" gradient — a soft radial fill derived
 * from the domain's primary color: a 22% inner stop brightening to a 12% outer
 * stop. Built with color-mix so it works for hex, hsl(), and var(--cat-*) token
 * values alike (the old version string-replaced an rgba alpha, which silently
 * flattened the gradient for any non-rgba color). Three knowledge circle
 * renderers (KnowledgeCircle, DomainCircle, PortraitDomainCircle) share it.
 * (Design audit C8 — consolidate the circle renderers behind one primitive.)
 */
export function domainBubbleGradient(base: string): string {
  return `radial-gradient(circle at 38% 38%, color-mix(in srgb, ${base} 22%, transparent), color-mix(in srgb, ${base} 12%, transparent))`
}

export type KnowledgeBubbleProps = {
  /** Circle diameter in px. */
  diameter: number
  /** Domain primary color; builds the radial gradient unless `background` is set. */
  tint?: string
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
  tint,
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
        background: background ?? (tint ? domainBubbleGradient(tint) : undefined),
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
