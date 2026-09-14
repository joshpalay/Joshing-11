import type { CSSProperties, MouseEventHandler, ReactNode } from 'react';
import Link from 'next/link';

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
//
// §4.3 — the interactive form (RATIFIED Josh 2026-09-13; built 2026-09-14,
// closing R4's ~12 filter/pick pills). Pass `href` for a chip-shaped nav
// link, `onClick` for a chip-shaped button; passing neither keeps the plain,
// non-interactive `span`. `selected` is for a genuine toggle (a filter, a
// friend picker) — it drives `aria-pressed` and the ink-fill selected state.
// Omit it for a one-shot pick chip (a suggestion, "+ topic", "restore")
// where there is no on/off to track. Interactive chips take `min-h-11` —
// the real §9.1 44px floor, not a padded hit box — so the visible pill is
// taller than a plain label Chip; that's the intended tell that it's tappable.

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

// For a component that renders its own <button> and can't wrap in <Chip>
// (AddToBankAction, SendQuestionAction) but wants to sit in a chip-styled
// action row. Keeps the geometry defined in exactly one place — do not
// hand-copy the recipe string at a call site, that's the R4 pattern this
// primitive exists to close.
export function chipButtonClassName({
  size = 'md',
  variant = 'neutral',
  selected,
  className,
}: { size?: ChipSize; variant?: ChipVariant; selected?: boolean; className?: string } = {}) {
  return cn(
    'inline-flex min-h-11 items-center gap-1 whitespace-nowrap rounded-full font-medium leading-none',
    SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    'cursor-pointer transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
    selected ? 'bg-foreground text-background' : 'hover:bg-muted',
    className,
  );
}

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
  role?: string;
  /** Renders as a Link instead of a span (a chip-shaped nav tag). */
  href?: string;
  /** Renders as a button instead of a span (a chip-shaped action or filter). */
  onClick?: MouseEventHandler<HTMLButtonElement>;
  disabled?: boolean;
  /** Toggle state for a real filter/selection chip. Omit for a one-shot pick. */
  selected?: boolean;
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
  role,
  href,
  onClick,
  disabled,
  selected,
}: ChipProps) {
  const geometry = cn(
    'inline-flex items-center gap-1 whitespace-nowrap rounded-full font-medium leading-none',
    SIZE_CLASSES[size],
    VARIANT_CLASSES[variant],
    uppercase && 'uppercase tracking-[0.08em]',
  );
  const content = (
    <>
      {leading}
      {children}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        title={title}
        aria-label={ariaLabel}
        role={role}
        className={cn(geometry, 'min-h-11 transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}
        style={style}
      >
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={title}
        aria-label={ariaLabel}
        aria-pressed={selected}
        role={role}
        className={cn(
          uppercase && 'uppercase tracking-[0.08em]',
          chipButtonClassName({ size, variant, selected, className }),
        )}
        style={style}
      >
        {content}
      </button>
    );
  }

  return (
    <span title={title} aria-label={ariaLabel} role={role} className={cn(geometry, className)} style={style}>
      {content}
    </span>
  );
}
