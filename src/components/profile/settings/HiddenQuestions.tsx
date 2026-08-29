'use client';

import { useState } from 'react';
import { RotateCcw } from 'lucide-react';

// The undo behind "Never show this question again".
//
// Permanent hiding is only safe against a finite question pool
// (D-SUPPLY-FINITE-SET-01) because this list exists: nothing is burned out of
// the corpus, and a mis-tap costs one trip here rather than a lost question.
// If this surface is ever removed, the durable per-question scope in
// NotForMeSheet has to go with it.

export type HiddenQuestionItem = {
  id: string;
  questionText: string;
  domain: string;
  hiddenAt: string;
};

export function HiddenQuestions({ initial }: { initial: HiddenQuestionItem[] }) {
  const [items, setItems] = useState(initial);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function restore(id: string) {
    if (restoring) return;
    setRestoring(id);
    setError(null);
    // Optimistic: the row leaves immediately, and comes back if the call fails.
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      const res = await fetch('/api/questions/hide', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ hidden_id: id }),
      });
      if (!res.ok) throw new Error('Could not bring that question back.');
    } catch (caught) {
      setItems(previous);
      setError(caught instanceof Error ? caught.message : 'Could not bring that question back.');
    } finally {
      setRestoring(null);
    }
  }

  return (
    <section className="mb-8" id="hidden-questions">
      <h2 className="mb-3 font-serif text-2xl font-semibold">Hidden questions</h2>
      <p className="text-muted-foreground mb-3 text-sm">
        {items.length === 0
          ? "You haven't hidden any questions. When you do, they'll be here to bring back."
          : 'Questions you asked us never to show again. Bring one back and it can appear in your five.'}
      </p>

      {error ? (
        <p className="mb-3 text-sm text-[var(--brand-alert)]" role="alert">
          {error}
        </p>
      ) : null}

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-start justify-between gap-3 rounded-2xl border border-[var(--brand-rule)] px-4 py-3"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <p className="text-sm text-foreground">{item.questionText}</p>
                <p className="text-quiet text-[var(--brand-ink-400)]">{item.domain}</p>
              </div>
              <button
                type="button"
                onClick={() => void restore(item.id)}
                disabled={restoring === item.id}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[var(--brand-rule)] px-3 py-1.5 text-sm font-medium transition hover:bg-muted disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <RotateCcw className="size-4" />
                {restoring === item.id ? 'Bringing back…' : 'Bring back'}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
