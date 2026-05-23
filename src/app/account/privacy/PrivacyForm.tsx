'use client';

import { useState } from 'react';

import type { DiscoverabilityState } from '@/server/db/queries/account';

type Props = {
  initialState: DiscoverabilityState;
};

type PatchKey = 'contacts' | 'mutualFriends';

async function patchDiscoverability(
  body: Partial<Record<PatchKey, boolean>>,
): Promise<{
  ok: boolean;
  state: DiscoverabilityState | null;
  errorMessage: string | null;
}> {
  const response = await fetch('/api/account/discoverability', {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await response.json().catch(() => null)) as {
    state?: DiscoverabilityState;
    message?: string;
  } | null;
  if (!response.ok) {
    return { ok: false, state: null, errorMessage: json?.message ?? 'Could not save.' };
  }
  return { ok: true, state: json?.state ?? null, errorMessage: null };
}

function ToggleRow({
  title,
  description,
  checked,
  saving,
  disabled,
  onToggle,
}: {
  title: string;
  description: string;
  checked: boolean;
  saving?: boolean;
  disabled?: boolean;
  onToggle?: () => void;
}) {
  return (
    <section className="rounded-xl border bg-card p-5 text-card-foreground">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col">
          <h2 className="font-serif text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={checked}
          aria-disabled={disabled || undefined}
          disabled={disabled || saving}
          onClick={onToggle}
          className={`relative inline-flex h-7 w-12 flex-none items-center rounded-full border transition ${
            checked ? 'bg-emerald-500 border-emerald-500' : 'bg-muted border-border'
          } ${disabled ? 'cursor-not-allowed opacity-60' : ''} ${
            saving ? 'opacity-60' : ''
          }`}
        >
          <span
            className={`inline-block size-5 rounded-full bg-white shadow transition ${
              checked ? 'translate-x-6' : 'translate-x-1'
            }`}
          />
        </button>
      </div>
    </section>
  );
}

export function PrivacyForm({ initialState }: Props) {
  const [state, setState] = useState<DiscoverabilityState>(initialState);
  const [savingKey, setSavingKey] = useState<PatchKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function toggle(key: PatchKey) {
    const previous = state;
    const next: DiscoverabilityState =
      key === 'contacts'
        ? { ...state, discoverableByContacts: !state.discoverableByContacts }
        : { ...state, discoverableByMutualFriends: !state.discoverableByMutualFriends };

    setState(next);
    setSavingKey(key);
    setErrorMessage(null);

    const body: Partial<Record<PatchKey, boolean>> =
      key === 'contacts'
        ? { contacts: next.discoverableByContacts }
        : { mutualFriends: next.discoverableByMutualFriends };

    const result = await patchDiscoverability(body);
    setSavingKey(null);

    if (!result.ok || !result.state) {
      setState(previous);
      setErrorMessage(result.errorMessage ?? 'Could not save.');
      return;
    }
    setState(result.state);
  }

  return (
    <div className="mt-8 space-y-6">
      <ToggleRow
        title="Match my phone contacts to other Joshing players"
        description="When you tap Refresh on Find Friends, we hash your contacts on your device and compare them against other players who also opted in. We never store the raw numbers."
        checked={state.discoverableByContacts}
        saving={savingKey === 'contacts'}
        onToggle={() => void toggle('contacts')}
      />

      <ToggleRow
        title="Suggest me through mutual friends"
        description="Lets people who share a friend with you see you in their Find Friends suggestions."
        checked={state.discoverableByMutualFriends}
        saving={savingKey === 'mutualFriends'}
        onToggle={() => void toggle('mutualFriends')}
      />

      <ToggleRow
        title="Findable by exact handle or phone number"
        description="Always on. Anyone who already knows your @handle or phone number can send you a friend request."
        checked
        disabled
      />

      {errorMessage ? (
        <p className="text-sm text-destructive">{errorMessage}</p>
      ) : null}
    </div>
  );
}
