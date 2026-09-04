'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Switch } from '@/components/ui/Switch';
import type { DiscoverabilityState } from '@/server/db/queries/account';

type Props = {
  initialState: DiscoverabilityState;
};

type PatchKey = 'contacts' | 'mutualFriends' | 'nicheMatch';

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
          <h3 className="font-serif text-lg font-semibold">{title}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={() => onToggle?.()}
          label={title}
          disabled={disabled || saving}
        />
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
        : key === 'mutualFriends'
          ? { ...state, discoverableByMutualFriends: !state.discoverableByMutualFriends }
          : { ...state, discoverableByNicheMatch: !state.discoverableByNicheMatch };

    setState(next);
    setSavingKey(key);
    setErrorMessage(null);

    const body: Partial<Record<PatchKey, boolean>> =
      key === 'contacts'
        ? { contacts: next.discoverableByContacts }
        : key === 'mutualFriends'
          ? { mutualFriends: next.discoverableByMutualFriends }
          : { nicheMatch: next.discoverableByNicheMatch };

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
    <div className="space-y-4">
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
        title="Let people I've never met discover me through questions we both answer"
        description="When you correctly answer a stranger's question (or they answer yours), each of you can see the other — a slow way to meet people through shared curiosity. Turn this off to stay hidden from strangers."
        checked={state.discoverableByNicheMatch}
        saving={savingKey === 'nicheMatch'}
        onToggle={() => void toggle('nicheMatch')}
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

      <section className="rounded-xl border bg-card p-5 text-card-foreground">
        <h3 className="font-serif text-lg font-semibold">Invite links</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Create, tag, and delete your invite links — and edit the topics they carry — from the
          Friends page.
        </p>
        <Link href="/friends" className="btn-ghost mt-3 inline-flex px-4">
          Go to Friends
        </Link>
      </section>
    </div>
  );
}
