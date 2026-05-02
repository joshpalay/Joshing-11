'use client';

import { Search, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type SendableQuestion = {
  id: string;
  text: string;
  domain: string;
};

type UserOption = {
  id: string;
  displayName: string;
};

type SendQuestionDrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  question: SendableQuestion;
  onSent?: () => void;
};

export function SendQuestionDrawer({ isOpen, onClose, question, onSent }: SendQuestionDrawerProps) {
  const [users, setUsers] = useState<UserOption[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [message, setMessage] = useState('');
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let active = true;
    setError(null);
    setLoadingUsers(true);
    fetch('/api/users', { cache: 'no-store', credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(body)) throw new Error(body?.message ?? 'Could not load people.');
        if (active) setUsers(body as UserOption[]);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load people.');
      })
      .finally(() => {
        if (active) setLoadingUsers(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) return;
    setSelectedId(null);
    setSearch('');
    setMessage('');
    setError(null);
  }, [isOpen]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const filteredUsers = useMemo(() => {
    const query = search.trim().toLowerCase();
    return users.filter((user) => !query || user.displayName.toLowerCase().includes(query));
  }, [search, users]);

  const selectedUser = users.find((user) => user.id === selectedId) ?? null;

  const sendQuestion = useCallback(async () => {
    if (!selectedId) return;
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/questions/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          questionId: question.id,
          recipientUserId: selectedId,
          personalMessage: message.trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.message ?? body?.error ?? 'Could not send that question.');
      }
      setToast('Sent ✓');
      onSent?.();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not send that question.');
    } finally {
      setSending(false);
    }
  }, [message, onClose, onSent, question.id, selectedId]);

  if (!isOpen) {
    return toast ? (
      <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg md:bottom-8">
        {toast}
      </div>
    ) : null;
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-end bg-black/35 md:items-stretch md:justify-end" role="dialog" aria-modal="true">
        <button className="absolute inset-0 cursor-default" type="button" aria-label="Close" onClick={onClose} />
        <aside className="relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg bg-background shadow-xl md:h-full md:max-h-none md:w-[440px] md:rounded-none">
          <header className="flex items-center justify-between gap-3 border-b p-5">
            <h2 className="font-serif text-2xl font-semibold">Send to a friend</h2>
            <button className="inline-flex size-10 items-center justify-center rounded-md border hover:bg-muted" type="button" onClick={onClose} title="Close">
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5">
            <section className="rounded-lg border bg-card p-4">
              <span className="inline-flex rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">{question.domain}</span>
              <p className="mt-3 text-sm font-medium leading-6 text-card-foreground">{question.text}</p>
            </section>

            <section className="mt-5">
              <h3 className="text-sm font-semibold">Who&apos;s this for?</h3>
              <label className="relative mt-3 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="h-11 w-full rounded-md border bg-background pl-10 pr-3 text-sm outline-none focus:border-primary"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name..."
                />
              </label>

              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border">
                {loadingUsers ? (
                  <p className="p-4 text-sm text-muted-foreground">Loading...</p>
                ) : filteredUsers.length === 0 ? (
                  <p className="p-4 text-sm text-muted-foreground">No people found.</p>
                ) : (
                  filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/60"
                      onClick={() => setSelectedId(user.id)}
                    >
                      <span className="inline-flex size-4 items-center justify-center rounded-full border border-primary">
                        {selectedId === user.id ? <span className="size-2 rounded-full bg-primary" /> : null}
                      </span>
                      <span className="text-sm font-medium">{user.displayName}</span>
                    </button>
                  ))
                )}
              </div>
            </section>

            <section className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Add a note (optional)</h3>
                <span className="text-xs text-muted-foreground">{message.length}/200</span>
              </div>
              <textarea
                className="mt-3 min-h-24 w-full resize-none rounded-md border bg-background p-3 text-sm outline-none focus:border-primary"
                maxLength={200}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Thought you'd like this"
              />
            </section>

            {error ? <p className="mt-4 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
          </div>

          <footer className="border-t p-5">
            <button
              className="btn-primary inline-flex h-11 w-full items-center justify-center gap-2"
              type="button"
              disabled={!selectedId || sending}
              onClick={() => void sendQuestion()}
            >
              <Send className="size-4" />
              {selectedUser ? `Send to ${selectedUser.displayName}` : 'Send'}
            </button>
          </footer>
        </aside>
      </div>
      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg md:bottom-8">
          {toast}
        </div>
      ) : null}
    </>
  );
}
