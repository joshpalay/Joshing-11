'use client';

import { useCallback, useState, type UIEvent } from 'react';

/**
 * Drives the gameplay header's condense-on-scroll behaviour. Returns a
 * `condensed` flag and an `onScroll` handler to attach to the scrolling region
 * (the play <section>). Uses asymmetric thresholds (condense once you've scrolled
 * past `condenseAt`, only re-expand once you're back above `expandAt`) so the
 * header doesn't flicker open/closed around a single trip point as the layout
 * reflows when it collapses.
 */
export function useCondensedOnScroll(options?: { condenseAt?: number; expandAt?: number }) {
  const condenseAt = options?.condenseAt ?? 40;
  const expandAt = options?.expandAt ?? 8;
  const [condensed, setCondensed] = useState(false);

  const onScroll = useCallback(
    (event: UIEvent<HTMLElement>) => {
      const top = event.currentTarget.scrollTop;
      setCondensed((prev) => {
        if (!prev && top > condenseAt) return true;
        if (prev && top < expandAt) return false;
        return prev;
      });
    },
    [condenseAt, expandAt],
  );

  return { condensed, onScroll };
}
