'use client';

import { ThumbsDown, ThumbsUp } from 'lucide-react';
import { useEffect, useState, useTransition } from 'react';

import { cn } from '@/lib/utils';

type Rating = 'up' | 'down';

type Counts = {
  up: number;
  down: number;
};

export function QuestionRatingButtons({ questionId }: { questionId: string }) {
  const [myRating, setMyRating] = useState<Rating | null>(null);
  const [counts, setCounts] = useState<Counts>({ up: 0, down: 0 });
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    let active = true;

    fetch(`/api/questions/${questionId}/rating`)
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { myRating: Rating | null; counts: Counts } | null) => {
        if (!active || !data) return;
        setMyRating(data.myRating);
        setCounts(data.counts);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [questionId]);

  function updateRating(next: Rating) {
    const previousRating = myRating;
    const previousCounts = counts;
    const rating = previousRating === next ? null : next;

    setMyRating(rating);
    setCounts({
      up: previousCounts.up + (rating === 'up' ? 1 : 0) - (previousRating === 'up' ? 1 : 0),
      down: previousCounts.down + (rating === 'down' ? 1 : 0) - (previousRating === 'down' ? 1 : 0),
    });

    startTransition(async () => {
      const response = await fetch(`/api/questions/${questionId}/rating`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rating }),
      });

      if (!response.ok) {
        setMyRating(previousRating);
        setCounts(previousCounts);
        return;
      }

      const fresh = await fetch(`/api/questions/${questionId}/rating`);
      if (fresh.ok) {
        const data = (await fresh.json()) as { myRating: Rating | null; counts: Counts };
        setMyRating(data.myRating);
        setCounts(data.counts);
      }
    });
  }

  return (
    <div className="flex items-center justify-end gap-2">
      <button
        aria-label="Thumbs up"
        aria-pressed={myRating === 'up'}
        className={cn(
          'text-muted-foreground inline-flex size-9 items-center justify-center rounded-md border transition',
          myRating === 'up'
            ? 'border-amber-300 bg-amber-100 text-amber-700'
            : 'border-border bg-background hover:bg-muted hover:text-foreground',
        )}
        disabled={isPending}
        type="button"
        onClick={() => updateRating('up')}
      >
        <ThumbsUp className="size-4" />
        <span className="sr-only">{counts.up}</span>
      </button>
      <button
        aria-label="Thumbs down"
        aria-pressed={myRating === 'down'}
        className={cn(
          'text-muted-foreground inline-flex size-9 items-center justify-center rounded-md border transition',
          myRating === 'down'
            ? 'border-stone-400 bg-stone-200 text-stone-800'
            : 'border-border bg-background hover:bg-muted hover:text-foreground',
        )}
        disabled={isPending}
        type="button"
        onClick={() => updateRating('down')}
      >
        <ThumbsDown className="size-4" />
        <span className="sr-only">{counts.down}</span>
      </button>
    </div>
  );
}
