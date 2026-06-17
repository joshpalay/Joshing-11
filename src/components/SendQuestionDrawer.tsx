'use client';

import { Check, Search, Send, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { Chip } from '@/components/ui/Chip';

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
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
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
        if (!response.ok || !Array.isArray(body)) throw new Error(body?.message ?? 'Could not load people.');
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
      setSelectedIds([]);
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

  const selectedUsers = users.filter((user) => selectedIds.includes(user.id));

  const toggleSelected = useCallback((id: string) => {
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((existing) => existing !== id) : [...current, id],
    );
  }, []);

  const sendQuestion = useCallback(async () => {
    if (selectedIds.length === 0) return;
    setSending(true);
    setError(null);

    // The send API takes one recipient per call, so fan out one request per
    // selected friend. Settle them all so a single failure (e.g. that friend
    // already has the question) doesn't drop the others.
    const recipients = users.filter((user) => selectedIds.includes(user.id));
    const results = await Promise.allSettled(
      recipients.map(async (recipient) => {
        const response = await fetch('/api/questions/send', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            questionId: question.id,
            recipientUserId: recipient.id,
            personalMessage: message.trim() || undefined,
          }),
        });
        const body = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(body?.message ?? body?.error ?? `Could not send to ${recipient.displayName}.`);
        }
      }),
    );

    const failures = results.flatMap((result, index) =>
      result.status === 'rejected'
        ? [{ id: recipients[index].id, name: recipients[index].displayName, reason: result.reason instanceof Error ? result.reason.message : 'Could not send that question.' }]
        : [],
    );
    const sentCount = results.length - failures.length;

    setSending(false);

    if (sentCount > 0) {
      onSent?.();
    }

    if (failures.length === 0) {
      setToast(sentCount > 1 ? `Sent to ${sentCount} people ✓` : 'Sent ✓');
      onClose();
      return;
    }

    // Some sends failed. Keep the drawer open so the user can see what happened,
    // and drop the recipients that did go through from the selection.
    const failedIds = new Set(failures.map((failure) => failure.id));
    setSelectedIds((current) => current.filter((id) => failedIds.has(id)));
    setError(
      sentCount > 0
        ? `Sent to ${sentCount} of ${results.length}. ${failures.map((failure) => `${failure.name}: ${failure.reason}`).join(' ')}`
        : failures.map((failure) => `${failure.name}: ${failure.reason}`).join(' '),
    );
  }, [message, onClose, onSent, question.id, selectedIds, users]);

  if (!isOpen) {
    return toast ? (
      <div className="fixed bottom-24 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg md:bottom-8">
        {toast}
      </div>
    ) : null;
  }

  return (
    <>
      <div className="fixed inset-0 z-[55] flex items-end bg-black/35 md:items-stretch md:justify-end" role="dialog" aria-modal="true">
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
              <Chip className="bg-secondary text-secondary-foreground">{question.domain}</Chip>
              <p className="mt-3 text-sm font-medium leading-6 text-card-foreground">{question.text}</p>
            </section>

            <section className="mt-5">
              <h3 className="text-sm font-semibold">Who&apos;s this for?</h3>
              <label className="relative mt-3 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  className="h-11 w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] pl-10 pr-3 text-sm outline-none focus:border-[var(--brand-navy)]"
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
                  filteredUsers.map((user) => {
                    const isSelected = selectedIds.includes(user.id);
                    return (
                      <button
                        key={user.id}
                        type="button"
                        className="flex w-full items-center gap-3 border-b px-4 py-3 text-left last:border-b-0 hover:bg-muted/60"
                        onClick={() => toggleSelected(user.id)}
                        aria-pressed={isSelected}
                      >
                        <span className={`inline-flex size-4 items-center justify-center rounded border ${isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-primary'}`}>
                          {isSelected ? <Check className="size-3" strokeWidth={3} /> : null}
                        </span>
                        <span className="text-sm font-medium">{user.displayName}</span>
                      </button>
                    );
                  })
                )}
              </div>
            </section>

            <section className="mt-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="text-sm font-semibold">Add a note (optional)</h3>
                <span className="text-xs text-muted-foreground">{message.length}/200</span>
              </div>
              <textarea
                className="mt-3 min-h-24 w-full resize-none rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] p-3 text-sm outline-none focus:border-[var(--brand-navy)]"
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
              className="btn-primary inline-flex w-full items-center justify-center gap-2"
              type="button"
              disabled={selectedIds.length === 0 || sending}
              onClick={() => void sendQuestion()}
            >
              <Send className="size-4" />
              {selectedUsers.length === 1
                ? `Send to ${selectedUsers[0].displayName}`
                : selectedUsers.length > 1
                  ? `Send to ${selectedUsers.length} people`
                  : 'Send'}
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
