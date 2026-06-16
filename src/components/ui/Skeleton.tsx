import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';

// One branded skeleton primitive (D-DESIGN-DEBT-STRUCTURAL-01, Phase 3).
//
// Replaces the per-route animate-pulse grey boxes the audit flagged (§5:
// rounded-[12px] vs rounded-lg, bg-black/[0.04] vs bg-muted, ad-hoc ring
// treatments) with a single shimmer treatment — the `.skeleton` class in
// globals.css: a muted base + a soft light sweep built from existing surface
// tokens. Neutral by design: no color conveys state, no triangle motif, and it
// honours prefers-reduced-motion (the sweep stops).
//
// Default radius is the canonical --radius-card so a skeleton block matches the
// real card it stands in for; pass `className` (h-*, w-*) to size each piece.
// Decorative, so always aria-hidden — callers pair it with an sr-only status.
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div
      aria-hidden
      className={cn('skeleton rounded-[var(--radius-card)]', className)}
      style={style}
    />
  );
}
