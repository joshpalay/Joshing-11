import type { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';

// One chip/tag primitive for the app (D-DESIGN-DEBT-STRUCTURAL-01, Phase 1).
//
// Before this, chips were ad-hoc inline `rounded-full` pills scattered across the
// feed, questions, friends, and play surfaces — each re-picking its own radius,
// padding, font size, and casing (see D-DESIGN-DEBT-STRUCTURAL-AUDIT-01-FINDINGS
// §2: radius rounded-full vs rounded-sm, padding px-2/px-2.5/px-3/px-3.5, sizes
// text-[9px]→text-sm, mixed casing). This consolidates the GEOMETRY and
// TYPOGRAPHY down to two intentional sizes.
//
// Scope is deliberately structural. Surface COLOR stays a caller concern and is
// deferred to the palette pass (audit CH-2): `variant` maps only to EXISTING
// neutral semantic tokens, and a caller that needs a category/status hue passes
// it via `className`/`style`. No new color and no state→color mapping is baked
// in here.
//
// Canon invariant (PRODUCT-CANON; STYLE-GUIDE-COLOR §1): a chip NEVER conveys
// state by color alone. `children` (the label) is REQUIRED, so every chip always
// carries a signal independent of hue. Any color a caller adds must be in
// ADDITION to the label, never instead of it.
//
// Not absorbed here (intentionally distinct primitives): `AvatarChip` (initials
// avatar) and `EditorialBadge` (the house-author semantic marker).

type ChipSize = 'sm' | 'md';

// Surface treatments resolve to existing neutral semantic tokens only.
type ChipVariant = 'neutral' | 'outline';

const SIZE_CLASSES: Record<ChipSize, string> = {
  // The padding + type ramp distilled from the audited render sites.
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-xs',
};

const VARIANT_CLASSES: Record<ChipVariant, string> = {
  neutral: 'bg-muted text-foreground',
  outline: 'border border-border text-foreground',
};

export type ChipProps = {
  /** The label. REQUIRED — a chip never signals state by color alone. */
  children: ReactNode;
  size?: ChipSize;
  variant?: ChipVariant;
  /** Caps + letterspacing label signature (System voice, STYLE-GUIDE-TYPE §2). */
  uppercase?: boolean;
  /** Optional leading element (e.g. a small icon). Decorative only. */
  leading?: ReactNode;
  className?: string;
  style?: CSSProperties;
  title?: string;
  'aria-label'?: string;
};

export function Chip({
  children,
  size = 'md',
  variant = 'neutral',
  uppercase = false,
  leading,
  className,
  style,
  title,
  'aria-label': ariaLabel,
}: ChipProps) {
  return (
    <span
      title={title}
      aria-label={ariaLabel}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium leading-none',
        SIZE_CLASSES[size],
        VARIANT_CLASSES[variant],
        uppercase && 'uppercase tracking-[0.08em]',
        className,
      )}
      style={style}
    >
      {leading}
      {children}
    </span>
  );
}
