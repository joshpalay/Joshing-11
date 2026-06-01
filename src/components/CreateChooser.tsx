'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Gamepad2, Pencil } from 'lucide-react';

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

  function addQuestion() {
    onClose();
    router.push('/questions?create=1');
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 px-0 pb-0 md:items-center md:px-4 md:pb-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-chooser-title"
    >
      <button
        className="absolute inset-0 cursor-default"
        type="button"
        aria-label="Close create chooser"
        onClick={onClose}
      />
      <section className="bg-background relative w-full rounded-t-2xl p-5 shadow-xl md:max-w-md md:rounded-2xl">
        <h2 id="create-chooser-title" className="font-serif text-2xl font-semibold">
          Create
        </h2>
        <div className="mt-5 grid gap-3">
          <button
            type="button"
            className="bg-card hover:bg-muted focus:ring-primary flex min-h-20 w-full items-center gap-4 rounded-lg border px-4 py-3 text-left transition focus:ring-2 focus:outline-none"
            onClick={addQuestion}
          >
            <span
              className="bg-primary/10 text-primary grid size-10 shrink-0 place-items-center rounded-full"
              aria-hidden="true"
            >
              <Pencil className="size-5" />
            </span>
            <span>
              <span className="block font-medium">Add a question</span>
              <span className="text-muted-foreground mt-1 block text-sm">
                Write a trivia question for the bank.
              </span>
            </span>
          </button>

          <button
            type="button"
            className="bg-card flex min-h-20 w-full cursor-not-allowed items-center gap-4 rounded-lg border px-4 py-3 text-left opacity-40"
            disabled
            aria-disabled="true"
          >
            <span
              className="bg-muted text-foreground grid size-10 shrink-0 place-items-center rounded-full"
              aria-hidden="true"
            >
              <Gamepad2 className="size-5" />
            </span>
            <span>
              <span className="block font-medium">Add a Joshing Game</span>
              <span className="text-muted-foreground mt-1 block text-sm">Coming soon.</span>
            </span>
          </button>
        </div>
        <div className="mt-5 flex justify-center">
          <button type="button" className="btn-ghost min-w-28" onClick={onClose}>
            Cancel
          </button>
        </div>
      </section>
    </div>
  );
}
