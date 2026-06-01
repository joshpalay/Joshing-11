'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Gamepad2, Pencil, Send, Users } from 'lucide-react';

// Capability 8: creating a question is a three-way choice surfaced up front —
// bank it only, send to your followers, or send to specific people. Sending
// always banks it too; these intents pre-select the matching destinations in
// the composer (the form still lets you adjust before saving). The
// 'send-to-followers' intent maps to the D-1 Stage 4 'friends' visibility
// (followers-only), not a hardcoded 'public'.
type CreateIntent = 'bank' | 'followers' | 'specific';

const QUESTION_OPTIONS: ReadonlyArray<{
  intent: CreateIntent;
  icon: typeof Pencil;
  title: string;
  description: string;
}> = [
  {
    intent: 'bank',
    icon: Pencil,
    title: 'Add to your bank',
    description: 'Save a question for yourself — improves your own Daily Five.',
  },
  {
    intent: 'followers',
    icon: Users,
    title: 'Send to followers',
    description: 'Share it with everyone who follows you (also banked).',
  },
  {
    intent: 'specific',
    icon: Send,
    title: 'Send to specific people',
    description: 'Pick exactly who gets it (also banked).',
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

  function addQuestion(intent: CreateIntent) {
    onClose();
    router.push(`/questions?create=1&intent=${intent}`);
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/35 px-0 pb-0 md:items-center md:px-4 md:pb-4" role="dialog" aria-modal="true" aria-labelledby="create-chooser-title">
      <button className="absolute inset-0 cursor-default" type="button" aria-label="Close create chooser" onClick={onClose} />
      <section className="relative w-full rounded-t-2xl bg-background p-5 shadow-xl md:max-w-md md:rounded-2xl">
        <h2 id="create-chooser-title" className="font-serif text-2xl font-semibold">Create a question</h2>
        <div className="mt-5 grid gap-3">
          {QUESTION_OPTIONS.map((option) => {
            const Icon = option.icon;
            return (
              <button
                key={option.intent}
                type="button"
                className="flex min-h-20 w-full items-center gap-4 rounded-lg border bg-card px-4 py-3 text-left transition hover:bg-muted focus:outline-none focus:ring-2 focus:ring-primary"
                onClick={() => addQuestion(option.intent)}
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

          <button
            type="button"
            className="flex min-h-20 w-full cursor-not-allowed items-center gap-4 rounded-lg border bg-card px-4 py-3 text-left opacity-40"
            disabled
            aria-disabled="true"
          >
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-foreground" aria-hidden="true">
              <Gamepad2 className="size-5" />
            </span>
            <span>
              <span className="block font-medium">Add a Joshing Game</span>
              <span className="mt-1 block text-sm text-muted-foreground">Coming soon.</span>
            </span>
          </button>
        </div>
        <div className="mt-5 flex justify-center">
          <button type="button" className="btn-ghost min-w-28" onClick={onClose}>Cancel</button>
        </div>
      </section>
    </div>
  );
}
