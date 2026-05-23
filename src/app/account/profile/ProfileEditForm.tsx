'use client';

import { Camera, Check, Loader2 } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { colorForUser, initialsFor } from '@/components/feed/visual';
import type { EditableProfile } from '@/server/db/queries/account';

type ProfileEditFormProps = {
  profile: EditableProfile;
  handleCooldownDays: number;
};

type FieldKey = 'displayName' | 'bio' | 'tagline' | 'location';

const FIELD_LIMITS: Record<FieldKey, number> = {
  displayName: 60,
  bio: 280,
  tagline: 80,
  location: 60,
};

const FIELD_LABELS: Record<FieldKey, string> = {
  displayName: 'Display name',
  bio: 'Bio',
  tagline: 'Tagline',
  location: 'Location',
};

const FIELD_PLACEHOLDERS: Record<FieldKey, string> = {
  displayName: 'What people call you',
  bio: 'Tell others what you’re about.',
  tagline: 'A short phrase that fits in one line.',
  location: 'City, region, or country',
};

const FIELD_MULTILINE: Partial<Record<FieldKey, boolean>> = {
  bio: true,
};

type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export function ProfileEditForm({ profile, handleCooldownDays }: ProfileEditFormProps) {
  const [values, setValues] = useState({
    displayName: profile.displayName,
    bio: profile.bio ?? '',
    tagline: profile.tagline ?? '',
    location: profile.location ?? '',
  });
  const [authorPublic, setAuthorPublic] = useState(profile.authorProfilePublic);
  const [handle, setHandle] = useState(profile.handle ?? '');
  const [handleLastChangedAt, setHandleLastChangedAt] = useState(profile.handleLastChangedAt);

  return (
    <div className="mt-8 flex flex-col gap-6">
      <AvatarBlock displayName={values.displayName} userId={profile.id} />

      <PhoneRow phoneNumber={profile.phoneNumber} />

      {(Object.keys(FIELD_LIMITS) as FieldKey[]).map((field) => (
        <EditableTextField
          key={field}
          field={field}
          value={values[field]}
          onSaved={(next) => setValues((prev) => ({ ...prev, [field]: next }))}
        />
      ))}

      <EditableHandleField
        value={handle}
        lastChangedAt={handleLastChangedAt}
        cooldownDays={handleCooldownDays}
        onSaved={(next, changedAt) => {
          setHandle(next);
          setHandleLastChangedAt(changedAt);
        }}
      />

      <AuthorProfileToggle
        value={authorPublic}
        onSaved={(next) => setAuthorPublic(next)}
      />
    </div>
  );
}

function AvatarBlock({ displayName, userId }: { displayName: string; userId: string }) {
  const initials = initialsFor(displayName || ' ');
  return (
    <section className="flex items-center gap-4">
      <div
        className="grid size-20 flex-none place-items-center rounded-full text-2xl font-semibold text-white shadow-sm"
        style={{ backgroundColor: colorForUser(userId) }}
        aria-hidden="true"
      >
        {initials}
      </div>
      <button
        type="button"
        disabled
        title="Photo uploads coming soon."
        className="inline-flex h-10 cursor-not-allowed items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium text-muted-foreground opacity-70"
      >
        <Camera className="size-4" />
        Change photo
      </button>
    </section>
  );
}

function PhoneRow({ phoneNumber }: { phoneNumber: string }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
        Phone
      </p>
      <p className="mt-2 text-base">{phoneNumber}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        Phone number can’t be changed once verified.
      </p>
    </section>
  );
}

type EditableTextFieldProps = {
  field: FieldKey;
  value: string;
  onSaved: (next: string) => void;
};

function EditableTextField({ field, value, onSaved }: EditableTextFieldProps) {
  const limit = FIELD_LIMITS[field];
  const multiline = FIELD_MULTILINE[field] ?? false;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const savedFlashTimer = useRef<number | null>(null);
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ('setSelectionRange' in inputRef.current) {
        const length = inputRef.current.value.length;
        inputRef.current.setSelectionRange(length, length);
      }
    }
  }, [editing]);

  useEffect(() => () => {
    if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
  }, []);

  const beginEdit = () => {
    setError(null);
    setDraft(value);
    setEditing(true);
  };

  const commit = useCallback(async () => {
    const trimmed = draft.trim();
    if (trimmed === value.trim()) {
      setEditing(false);
      return;
    }
    if (field === 'displayName' && trimmed.length === 0) {
      setError('Display name can’t be empty.');
      return;
    }
    if (trimmed.length > limit) {
      setError(`Maximum ${limit} characters.`);
      return;
    }

    setStatus('saving');
    setError(null);
    try {
      // For non-required fields, send null to clear when the user emptied
      // the input. For displayName (required) we already returned above.
      const payload: Record<string, string | null> = {};
      payload[field] = trimmed.length === 0 ? null : trimmed;

      const response = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message ?? 'Could not save.');
      }
      onSaved(trimmed);
      setStatus('saved');
      setEditing(false);
      if (savedFlashTimer.current) window.clearTimeout(savedFlashTimer.current);
      savedFlashTimer.current = window.setTimeout(() => setStatus('idle'), 1500);
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    }
  }, [draft, value, field, limit, onSaved]);

  const cancel = () => {
    setDraft(value);
    setEditing(false);
    setError(null);
    setStatus('idle');
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          {FIELD_LABELS[field]}
        </p>
        <SaveStatusIndicator status={status} />
      </div>

      {editing ? (
        <div className="mt-2">
          {multiline ? (
            <textarea
              ref={(el) => {
                inputRef.current = el;
              }}
              className="min-h-20 w-full resize-y rounded-md border bg-background px-3 py-2 text-base outline-none focus:border-foreground"
              value={draft}
              maxLength={limit}
              placeholder={FIELD_PLACEHOLDERS[field]}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void commit();
                } else if (e.key === 'Escape') {
                  cancel();
                }
              }}
              disabled={status === 'saving'}
            />
          ) : (
            <input
              ref={(el) => {
                inputRef.current = el;
              }}
              className="w-full rounded-md border bg-background px-3 py-2 text-base outline-none focus:border-foreground"
              value={draft}
              maxLength={limit}
              placeholder={FIELD_PLACEHOLDERS[field]}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => void commit()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void commit();
                } else if (e.key === 'Escape') {
                  cancel();
                }
              }}
              disabled={status === 'saving'}
            />
          )}
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{multiline ? '⌘+Enter to save, Esc to cancel' : 'Enter to save, Esc to cancel'}</span>
            <span className={draft.length > limit ? 'text-destructive' : ''}>
              {draft.length} / {limit}
            </span>
          </div>
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 block w-full rounded-md px-1 py-1 text-left text-base hover:bg-muted/40"
          onClick={beginEdit}
        >
          {value.trim().length > 0 ? (
            <span className="whitespace-pre-wrap">{value}</span>
          ) : (
            <span className="text-muted-foreground">{FIELD_PLACEHOLDERS[field]}</span>
          )}
        </button>
      )}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

type EditableHandleFieldProps = {
  value: string;
  lastChangedAt: string | null;
  cooldownDays: number;
  onSaved: (next: string, changedAt: string) => void;
};

function EditableHandleField({
  value,
  lastChangedAt,
  cooldownDays,
  onSaved,
}: EditableHandleFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [confirming, setConfirming] = useState(false);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const cooldownInfo = computeHandleCooldown(lastChangedAt, cooldownDays);

  const beginEdit = () => {
    setError(null);
    setDraft(value);
    setEditing(true);
    setConfirming(false);
  };

  const cancel = () => {
    setEditing(false);
    setConfirming(false);
    setDraft(value);
    setError(null);
  };

  const requestSave = () => {
    const trimmed = draft.trim().toLowerCase();
    if (trimmed === value.trim().toLowerCase()) {
      setEditing(false);
      return;
    }
    if (cooldownInfo.locked) {
      setError(
        `You can change your handle again on ${cooldownInfo.unlockDate.toLocaleDateString()}.`,
      );
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const confirmSave = async () => {
    setStatus('saving');
    setError(null);
    try {
      const response = await fetch('/api/account/handle', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ handle: draft.trim().toLowerCase() }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; handle?: string; message?: string; retryAfter?: string }
        | null;
      if (!response.ok || !body?.ok || !body.handle) {
        throw new Error(body?.message ?? 'Could not save.');
      }
      onSaved(body.handle, new Date().toISOString());
      setStatus('saved');
      setEditing(false);
      setConfirming(false);
      window.setTimeout(() => setStatus('idle'), 1500);
    } catch (caught) {
      setStatus('error');
      setError(caught instanceof Error ? caught.message : 'Could not save.');
      setConfirming(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
          Handle
        </p>
        <SaveStatusIndicator status={status} />
      </div>

      {editing ? (
        <div className="mt-2">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">@</span>
            <input
              autoFocus
              className="flex-1 rounded-md border bg-background px-3 py-2 text-base outline-none focus:border-foreground"
              value={draft}
              maxLength={20}
              placeholder="handle"
              onChange={(e) => setDraft(e.target.value.toLowerCase())}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  requestSave();
                } else if (e.key === 'Escape') {
                  cancel();
                }
              }}
              disabled={status === 'saving'}
            />
          </div>
          {confirming ? (
            <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p>
                You can change your handle once every {cooldownDays} days. Continue?
              </p>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                  onClick={() => void confirmSave()}
                  disabled={status === 'saving'}
                >
                  Yes, change it
                </button>
                <button
                  type="button"
                  className="rounded-md border border-amber-300 px-3 py-1 text-xs"
                  onClick={cancel}
                  disabled={status === 'saving'}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Enter to save, Esc to cancel</span>
              <span>{draft.length} / 20</span>
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 block w-full rounded-md px-1 py-1 text-left text-base hover:bg-muted/40"
          onClick={beginEdit}
        >
          {value.trim().length > 0 ? (
            <span>@{value}</span>
          ) : (
            <span className="text-muted-foreground">Pick a handle</span>
          )}
        </button>
      )}

      {cooldownInfo.locked ? (
        <p className="mt-2 text-xs text-muted-foreground">
          Next change available {cooldownInfo.unlockDate.toLocaleDateString()}.
        </p>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          You can change your handle once every {cooldownDays} days.
        </p>
      )}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

function computeHandleCooldown(lastChangedAtIso: string | null, cooldownDays: number) {
  if (!lastChangedAtIso) return { locked: false, unlockDate: new Date(0) };
  const lastChanged = new Date(lastChangedAtIso);
  const unlockDate = new Date(lastChanged.getTime() + cooldownDays * 24 * 60 * 60 * 1000);
  return { locked: unlockDate.getTime() > Date.now(), unlockDate };
}

type AuthorProfileToggleProps = {
  value: boolean;
  onSaved: (next: boolean) => void;
};

function AuthorProfileToggle({ value, onSaved }: AuthorProfileToggleProps) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = async () => {
    setSaving(true);
    setError(null);
    const next = !value;
    try {
      const response = await fetch('/api/account/profile', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ authorProfilePublic: next }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; message?: string }
        | null;
      if (!response.ok || !body?.ok) {
        throw new Error(body?.message ?? 'Could not save.');
      }
      onSaved(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-medium">
            Show authored questions on my profile
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            When off, the “Questions {`{name}`} wrote” section is hidden from
            other Joshing players viewing your profile.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={value}
          disabled={saving}
          onClick={() => void toggle()}
          className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition ${
            value ? 'bg-emerald-500 border-emerald-500' : 'bg-muted border-border'
          } ${saving ? 'opacity-60' : ''}`}
        >
          <span
            className={`inline-block size-5 rounded-full bg-white shadow transition ${
              value ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
    </section>
  );
}

function SaveStatusIndicator({ status }: { status: SaveStatus }) {
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="size-3 animate-spin" />
        Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
        <Check className="size-3" />
        Saved
      </span>
    );
  }
  return null;
}
