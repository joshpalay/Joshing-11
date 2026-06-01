'use client';

import { useEffect, useRef, useState } from 'react';

const MAX_NOTE_LENGTH = 160;
const COUNTER_VISIBLE_AT = 120;

type Props = {
  onClose: () => void;
  targetUserId: string;
  targetDisplayName: string;
  // Called with the new friendship id after a successful send. The parent
  // typically flips its UI to "pending_outbound" and refreshes.
  onSent: (friendshipId: string) => void;
};

type SendErrorKey =
  | 'already_friends'
  | 'already_pending'
  | 'inbound_exists'
  | 'recently_sent'
  | 'not_found'
  | 'invalid_body'
  | 'self_request'
  | 'network'
  | 'unknown';

function describeError(error: SendErrorKey, message?: string): string {
  if (message) return message;
  switch (error) {
    case 'already_friends':
      return 'You are already friends.';
    case 'already_pending':
      return 'You already have a pending request with this person.';
    case 'inbound_exists':
      return 'They sent you a request — accept it instead.';
    case 'recently_sent':
      return 'You sent this person a request recently. Try again later.';
    case 'not_found':
      return 'This person isn’t available right now.';
    case 'invalid_body':
      return 'That note didn’t look right. Try shortening it.';
    case 'self_request':
      return 'You cannot friend yourself.';
    case 'network':
      return 'Network error. Please try again.';
    default:
      return 'Something went wrong. Please try again.';
  }
}

// Parent mounts this component when the modal should be open and unmounts
// it on close. That keeps state (note draft, error) fresh on each open
// without needing a reset-on-open effect.
export function AddFriendRequestModal({ onClose, targetUserId, targetDisplayName, onSent }: Props) {
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function send() {
    if (sending) return;
    const trimmed = note.trim();
    if (trimmed.length > MAX_NOTE_LENGTH) {
      setError(`Notes are capped at ${MAX_NOTE_LENGTH} characters.`);
      return;
    }
    setSending(true);
    setError(null);
    try {
      const response = await fetch('/api/friend-requests', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          inviteeUserId: targetUserId,
          personalNote: trimmed.length > 0 ? trimmed : undefined,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok: boolean; friendship?: { id: string } }
        | { error: SendErrorKey; message?: string }
        | null;

      if (!response.ok || !body || !('ok' in body) || !body.ok || !body.friendship) {
        const errorBody = body && 'error' in body ? body : null;
        setError(describeError(errorBody?.error ?? 'unknown', errorBody?.message));
        return;
      }
      onSent(body.friendship.id);
      onClose();
    } catch {
      setError(describeError('network'));
    } finally {
      setSending(false);
    }
  }

  const counterVisible = note.length >= COUNTER_VISIBLE_AT;
  const remaining = MAX_NOTE_LENGTH - note.length;

  return (
    <>
      <div
        onClick={() => {
          if (!sending) onClose();
        }}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.4)',
          zIndex: 100,
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-friend-request-title"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 101,
          width: 'min(520px, calc(100vw - 32px))',
          maxHeight: 'calc(100dvh - 64px)',
          overflowY: 'auto',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-paper-rest)',
          padding: '24px',
        }}
      >
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 id="add-friend-request-title" className="font-serif text-xl font-semibold">
            Send {targetDisplayName} a friend request
          </h2>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            disabled={sending}
            className="text-muted-foreground hover:text-foreground -mr-1 px-2 text-lg leading-none"
          >
            ×
          </button>
        </div>
        <p className="text-muted-foreground mb-4 text-sm">
          Add a short note (optional) — they’ll see it with the request.
        </p>
        <textarea
          ref={textareaRef}
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, MAX_NOTE_LENGTH))}
          maxLength={MAX_NOTE_LENGTH}
          rows={4}
          placeholder="Hey — I keep meaning to ask you about that thing…"
          disabled={sending}
          className="border-border bg-card text-foreground placeholder:text-muted-foreground focus:ring-primary/40 w-full resize-none rounded-lg border p-3 text-sm focus:ring-2 focus:outline-none"
        />
        <div className="mt-1 flex h-5 items-center justify-end">
          {counterVisible ? (
            <span
              className={`text-xs ${remaining < 0 ? 'text-destructive' : 'text-muted-foreground'}`}
            >
              {remaining} left
            </span>
          ) : null}
        </div>
        {error ? <p className="text-destructive mt-2 text-sm">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={sending}>
            Cancel
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void send()}
            disabled={sending}
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </div>
    </>
  );
}
