'use client';

import { useRef, useState, type ReactNode, type UIEvent } from 'react';

import { cn } from '@/lib/utils';

import { usePrefersReducedMotion } from './usePrefersReducedMotion';

type EditorialCarouselProps = {
  // One node per slide. The carousel shows one slide per view and renders a
  // pagination dot for each.
  slides: ReactNode[];
  // Describes the set for assistive tech (e.g. "Shared interests").
  ariaLabel?: string;
};

/**
 * A horizontal, one-slide-per-view carousel for the editorial `artwork` slot.
 *
 * Built on native CSS scroll-snap rather than the pointer-math swipe in
 * FeedCardSwipe — the browser handles the drag/fling/snap, we only mirror the
 * scroll position into pagination dots (which are also tappable). Respects
 * prefers-reduced-motion by jumping dot taps instantly. SSR-safe: with no
 * client scroll yet, the first dot reads active.
 */
export function EditorialCarousel({ slides, ariaLabel }: EditorialCarouselProps) {
  const reducedMotion = usePrefersReducedMotion();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  function handleScroll(event: UIEvent<HTMLDivElement>) {
    const track = event.currentTarget;
    const next = Math.round(track.scrollLeft / track.clientWidth);
    setActiveIndex((prev) => (prev === next ? prev : next));
  }

  function goTo(index: number) {
    const track = trackRef.current;
    if (!track) return;
    track.scrollTo({
      left: index * track.clientWidth,
      behavior: reducedMotion ? 'auto' : 'smooth',
    });
  }

  return (
    <div>
      <div
        ref={trackRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={ariaLabel}
        onScroll={handleScroll}
        className={cn(
          'flex snap-x snap-mandatory overflow-x-auto',
          // Hide the native scrollbar — the dots are the affordance.
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
      >
        {slides.map((slide, i) => (
          <div key={i} className="flex shrink-0 basis-full snap-start items-end">
            {slide}
          </div>
        ))}
      </div>

      {slides.length > 1 ? (
        <div className="mt-7 flex items-center gap-2">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Go to item ${i + 1} of ${slides.length}`}
              aria-current={i === activeIndex ? 'true' : undefined}
              className={cn(
                'size-2 rounded-full transition-colors',
                i === activeIndex
                  ? 'bg-[var(--brand-ink)]'
                  : 'bg-[var(--brand-ink-400)]/40 hover:bg-[var(--brand-ink-400)]/70',
              )}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
