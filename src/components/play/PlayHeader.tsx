'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Shared sticky header for the gameplay surfaces (Daily Five + Catch-up).
 *
 * The progress dots and the close button stay pinned at all times; the
 * eyebrow/title block collapses when `condensed` is set (driven by
 * useCondensedOnScroll), so scrolling into the thread reclaims the vertical
 * space the two-line title would otherwise hold. The collapse animates via a
 * 1fr→0fr grid row so it eases to the title's real height without a hard-coded
 * max-height guess (titles here wrap to two lines on narrow screens).
 *
 * Opaque --surface (not a translucent blur) so the thread cards scrolling
 * underneath never bleed through the header.
 */
export function PlayHeader({
  eyebrow,
  title,
  dots,
  condensed,
  closeHref = '/',
  closeLabel = 'Close',
}: {
  eyebrow: string;
  title: ReactNode;
  dots?: ReactNode;
  condensed: boolean;
  closeHref?: string;
  closeLabel?: string;
}) {
  return (
    <header
      className="sticky top-0 z-20 border-b px-4"
      style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
    >
      <div className="flex items-center justify-between gap-3">
        <div
          className="min-w-0 grid transition-[grid-template-rows,opacity] duration-200 ease-out"
          style={{
            gridTemplateRows: condensed ? '0fr' : '1fr',
            opacity: condensed ? 0 : 1,
          }}
        >
          <div className="min-h-0 overflow-hidden">
            <div className="py-2.5">
              <p className="text-xs tracking-[0.1em] text-[var(--text-muted)] uppercase">
                {eyebrow}
              </p>
              <h1 className="font-serif text-xl font-semibold text-[var(--text)]">{title}</h1>
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 py-1.5">
          {dots}
          <Link
            href={closeHref}
            aria-label={closeLabel}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--text-muted)] transition hover:bg-[var(--surface-2)] hover:text-[var(--text)] focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:outline-none"
          >
            <X className="size-5" strokeWidth={1.9} />
          </Link>
        </div>
      </div>
    </header>
  );
}
