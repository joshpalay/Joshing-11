'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Pencil, UserPlus } from 'lucide-react';

// The chooser used to split "add a question" into three destination-specific
// intents (bank / send to friends / send to specific people) surfaced as
// separate buttons. Collapsed to one "Add a question" entry (Josh,
// 2026-09-15): the composer it opens already lets the author pick every
// destination themselves, so the three-way split was just extra taps to the
// same form, not a real fork. The `?intent=` param itself is untouched —
// TodaysFiveCard and FeedList's inline composer entry points still pass
// `intent=bank` directly — this only changes what the chooser itself offers.
const OPTIONS: ReadonlyArray<{
  key: 'question' | 'friend';
  icon: typeof Pencil;
  title: string;
  description: string;
  href: string;
}> = [
  {
    key: 'question',
    icon: Pencil,
    title: 'Add a question',
    description: 'Save it to your bank, then choose who sees it.',
    href: '/questions?create=1',
  },
  {
    key: 'friend',
    icon: UserPlus,
    title: 'Add a friend',
    description: 'Text someone a personal invite.',
    href: '/friends?invite=1',
  },
];

export function CreateChooser({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();

  useEffect(() => {
    if (!open) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end justify-center bg-[var(--scrim)] px-0 pb-0 md:items-center md:px-4 md:pb-4" role="dialog" aria-modal="true" aria-labelledby="create-chooser-title">
      <button className="absolute inset-0 cursor-default" type="button" aria-label="Close create chooser" onClick={onClose} />
      <section className="relative w-full rounded-t-2xl bg-background p-5 shadow-[var(--shadow-overlay)] md:max-w-md md:rounded-2xl">
        <h2 id="create-chooser-title" className="font-serif text-2xl font-semibold">Create</h2>
        <div className="mt-5 grid gap-3">
          {OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.key}
                type="button"
                className="flex min-h-20 w-full items-center gap-4 rounded-[var(--radius-card)] border bg-card px-4 py-3 text-left transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
                onClick={() => {
                  onClose();
                  router.push(option.href);
                }}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary" aria-hidden="true">
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block font-medium">{option.title}</span>
                  <span className="mt-1 block text-sm text-muted-foreground">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-5 flex justify-center">
          <button type="button" className="btn-ghost min-w-28" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
