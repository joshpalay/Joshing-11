'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

type CreatorNoteFormProps = {
  questionId: string;
  recipientUserId: string;
};

export function CreatorNoteForm({ questionId, recipientUserId }: CreatorNoteFormProps) {
  const router = useRouter();
  const [noteText, setNoteText] = useState('');
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  function sendNote() {
    const trimmed = noteText.trim();
    if (!trimmed) {
      setError('Write a note first.');
      return;
    }
    if (trimmed.length > 500) {
      setError('Keep it to 500 characters.');
      return;
    }

    setError(null);
    startTransition(async () => {
      const response = await fetch('/api/creator-notes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ questionId, recipientUserId, noteText: trimmed }),
      });

      if (!response.ok) {
        setError('Could not send the note. The link may no longer be valid.');
        return;
      }

      setToast('Note sent.');
      window.setTimeout(() => router.push('/'), 600);
    });
  }

  return (
    <div className="mt-5 space-y-3">
      <label className="block">
        <span className="text-sm font-medium text-foreground">Your note</span>
        <textarea
          className="mt-2 min-h-36 w-full resize-y rounded-md border bg-background p-3 text-sm outline-none focus:border-primary"
          maxLength={500}
          placeholder="I always think of you when I hear this question..."
          value={noteText}
          onChange={(event) => setNoteText(event.target.value)}
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{noteText.length}/500</p>
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <button className="btn-primary sm:flex-1" disabled={isPending} type="button" onClick={sendNote}>
          {isPending ? 'Sending...' : 'Send note'}
        </button>
        <button className="btn-ghost sm:flex-1" type="button" onClick={() => router.push('/')}>
          Maybe later
        </button>
      </div>
      {toast ? (
        <div className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}
    </div>
  );
}
