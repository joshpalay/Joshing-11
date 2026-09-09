'use client';

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type UIEvent,
} from 'react';

import { cn } from '@/lib/utils';

import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export type EditorialCarouselHandle = {
  goTo: (index: number) => void;
};

type EditorialCarouselProps = {
  // One node per slide. The carousel shows one slide per view and renders a
  // pagination dot for each.
  slides: ReactNode[];
  // Describes the set for assistive tech (e.g. "Shared interests").
  ariaLabel?: string;
  // Fired when the visible slide changes (scroll or dot tap), so a parent can
  // mirror copy outside the artwork (e.g. a headline) to the active slide.
  onActiveIndexChange?: (index: number) => void;
  // Fired once, on mount/slides-change, with the slide count — lets a parent
  // that renders its own pagination (see `hideDots`) size it without
  // duplicating the chunking logic that produced `slides`.
  onSlideCountChange?: (count: number) => void;
  // Suppress the built-in pagination-dots row — for a caller that renders its
  // own dots elsewhere (e.g. inline in a card header) via this component's
  // forwarded `goTo` handle instead.
  hideDots?: boolean;
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
export const EditorialCarousel = forwardRef<EditorialCarouselHandle, EditorialCarouselProps>(
  function EditorialCarousel(
    { slides, ariaLabel, onActiveIndexChange, onSlideCountChange, hideDots = false },
    ref,
  ) {
    const reducedMotion = usePrefersReducedMotion();
    const trackRef = useRef<HTMLDivElement | null>(null);
    const [activeIndex, setActiveIndex] = useState(0);

    function handleScroll(event: UIEvent<HTMLDivElement>) {
      const track = event.currentTarget;
      const next = Math.round(track.scrollLeft / track.clientWidth);
      if (next === activeIndex) return;
      setActiveIndex(next);
      onActiveIndexChange?.(next);
    }

    const goTo = useCallback(
      (index: number) => {
        const track = trackRef.current;
        if (!track) return;
        track.scrollTo({
          left: index * track.clientWidth,
          behavior: reducedMotion ? 'auto' : 'smooth',
        });
      },
      [reducedMotion],
    );

    useImperativeHandle(ref, () => ({ goTo }), [goTo]);

    useEffect(() => {
      onSlideCountChange?.(slides.length);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slides.length]);

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

        {!hideDots && slides.length > 1 ? (
          <CarouselDots count={slides.length} activeIndex={activeIndex} onGoTo={goTo} className="mt-7" />
        ) : null}
      </div>
    );
  },
);

/**
 * The pagination-dot row, split out so a caller can render it outside the
 * carousel's own layout flow (e.g. inline in a card header) while still
 * driving the carousel via its forwarded `goTo` handle.
 */
export function CarouselDots({
  count,
  activeIndex,
  onGoTo,
  className,
  dotClassName,
}: {
  count: number;
  activeIndex: number;
  onGoTo: (index: number) => void;
  className?: string;
  dotClassName?: string;
}) {
  if (count <= 1) return null;
  return (
    <div className={cn('flex items-center gap-2', className)}>
      {Array.from({ length: count }, (_, i) => (
        <button
          key={i}
          type="button"
          onClick={() => onGoTo(i)}
          aria-label={`Go to item ${i + 1} of ${count}`}
          aria-current={i === activeIndex ? 'true' : undefined}
          className={cn(
            'size-2 rounded-full transition-colors',
            i === activeIndex
              ? 'bg-[var(--brand-ink)]'
              : 'bg-[var(--brand-ink-400)]/40 hover:bg-[var(--brand-ink-400)]/70',
            dotClassName,
          )}
        />
      ))}
    </div>
  );
}
