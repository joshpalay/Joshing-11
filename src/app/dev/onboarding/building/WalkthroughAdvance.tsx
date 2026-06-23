'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/**
 * Walkthrough glue: after a beat on the "building your five" state, advance to
 * the next harness stage (the first-session recap). A manual skip is offered for
 * impatience. Only mounted in `?walk=1` mode.
 */
export function WalkthroughAdvance({
  nextHref,
  delayMs = 2800,
}: {
  nextHref: string;
  delayMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => router.push(nextHref), delayMs);
    return () => clearTimeout(timer);
  }, [router, nextHref, delayMs]);

  return (
    <div className="fixed inset-x-0 bottom-0 z-50 flex justify-center pb-[calc(1.5rem+env(safe-area-inset-bottom))]">
      <Link
        href={nextHref}
        className="rounded-full border border-[var(--brand-border)] bg-[var(--brand-card)] px-4 py-2 text-sm font-medium text-[var(--brand-ink-700)] shadow-[var(--shadow-card)] hover:text-[var(--brand-ink)]"
      >
        Skip to first-session recap →
      </Link>
    </div>
  );
}
