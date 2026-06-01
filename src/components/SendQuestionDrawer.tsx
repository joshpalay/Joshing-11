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
    // Run the load (incl. its initial loading/error state) inside an async
    // function rather than synchronously in the effect body, which the
    // react-hooks set-state-in-effect rule flags.
    void (async () => {
      setError(null);
      setLoadingUsers(true);
      try {
        const response = await fetch('/api/users', { cache: 'no-store', credentials: 'include' });
        const body = await response.json().catch(() => null);
        if (!response.ok || !Array.isArray(body))
          throw new Error(body?.message ?? 'Could not load people.');
        if (active) setUsers(body as UserOption[]);
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not load people.');
      } finally {
        if (active) setLoadingUsers(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [isOpen]);

  // Reset the form when the drawer closes — done during render via a stored
  // previous value (not a set-state-in-effect) per the React docs.
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (prevIsOpen !== isOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen) {
      setSelectedId(null);
      setSearch('');
      setMessage('');
      setError(null);
    }
  }

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
      <div className="bg-foreground text-background fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg md:bottom-8">
        {toast}
      </div>
    ) : null;
  }

  return (
    <>
      <div
        className="fixed inset-0 z-[55] flex items-end bg-black/35 md:items-stretch md:justify-end"
        role="dialog"
        aria-modal="true"
      >
        <button
          className="absolute inset-0 cursor-default"
          type="button"
          aria-label="Close"
          onClick={onClose}
        />
        <aside className="bg-background relative flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-lg shadow-xl md:h-full md:max-h-none md:w-[440px] md:rounded-none">
          <header className="flex items-center justify-between gap-3 border-b p-5">
            <h2 className="font-serif text-2xl font-semibold">Send to a friend</h2>
            <button
              className="hover:bg-muted inline-flex size-10 items-center justify-center rounded-md border"
              type="button"
              onClick={onClose}
              title="Close"
            >
              <X className="size-4" />
            </button>
          </header>

          <div className="flex-1 overflow-y-auto p-5">
            <section className="bg-card rounded-lg border p-4">
              <span className="bg-secondary text-secondary-foreground inline-flex rounded-full px-2.5 py-1 text-xs">
                {question.domain}
              </span>
              <p className="text-card-foreground mt-3 text-sm leading-6 font-medium">
                {question.text}
              </p>
            </section>

            <section className="mt-5">
              <h3 className="text-sm font-semibold">Who&apos;s this for?</h3>
              <label className="relative mt-3 block">
                <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
                <input
                  className="bg-background focus:border-primary h-11 w-full rounded-md border pr-3 pl-10 text-sm outline-none"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search by name..."
                />
              </label>

              <div className="mt-3 max-h-64 overflow-y-auto rounded-lg border">
                {loadingUsers ? (
                  <p className="text-muted-foreground p-4 text-sm">Loading...</p>
                ) : filteredUsers.length === 0 ? (
                  <p className="text-muted-foreground p-4 text-sm">No people found.</p>
                ) : (
                  filteredUsers.map((user) => (
                    <button
                      key={user.id}
                      type="button"
                      className="hover:bg-muted/60 flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0"
                      onClick={() => setSelectedId(user.id)}
                    >
                      <span className="border-primary inline-flex size-4 items-center justify-center rounded-full border">
                        {selectedId === user.id ? (
                          <span className="bg-primary size-2 rounded-full" />
                        ) : null}
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
                <span className="text-muted-foreground text-xs">{message.length}/200</span>
              </div>
              <textarea
                className="bg-background focus:border-primary mt-3 min-h-24 w-full resize-none rounded-md border p-3 text-sm outline-none"
                maxLength={200}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Thought you'd like this"
              />
            </section>

            {error ? (
              <p className="border-destructive/40 bg-destructive/10 text-destructive mt-4 rounded-md border p-3 text-sm">
                {error}
              </p>
            ) : null}
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
        <div className="bg-foreground text-background fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-lg md:bottom-8">
          {toast}
        </div>
      ) : null}
    </>
  );
}
