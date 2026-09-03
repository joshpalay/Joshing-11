'use client';

import { useEffect, useState } from 'react';

import { Switch } from '@/components/ui/Switch';
import type { DiscoverabilityState } from '@/server/db/queries/account';

type Props = {
  initialState: DiscoverabilityState;
  initialInviteUrl: string | null;
  initialSeedTopics: string[];
};

type PatchKey = 'contacts' | 'mutualFriends' | 'nicheMatch';

type InviteTokenResponse = { token: string; url: string };

const SEED_TOPIC_CAP = 3;

type TopicsResponse = { topics?: string[]; message?: string };

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

export function PrivacyForm({ initialState, initialInviteUrl, initialSeedTopics }: Props) {
  const [state, setState] = useState<DiscoverabilityState>(initialState);
  const [savingKey, setSavingKey] = useState<PatchKey | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(initialInviteUrl);
  const [rotating, setRotating] = useState(false);
  const [confirmingRotate, setConfirmingRotate] = useState(false);
  const [inviteToast, setInviteToast] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [seedTopics, setSeedTopics] = useState<string[]>(initialSeedTopics);
  const [seedTopicDraft, setSeedTopicDraft] = useState('');
  const [savingTopics, setSavingTopics] = useState(false);
  const [seedTopicsError, setSeedTopicsError] = useState<string | null>(null);
  const [seedTopicsSaved, setSeedTopicsSaved] = useState(false);

  useEffect(() => {
    if (!inviteToast) return;
    const timer = window.setTimeout(() => setInviteToast(null), 1800);
    return () => window.clearTimeout(timer);
  }, [inviteToast]);

  async function copyInviteUrl() {
    if (!inviteUrl) return;
    setInviteError(null);
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteToast('Link copied.');
    } catch {
      setInviteError('Could not copy. Long-press the field to copy manually.');
    }
  }

  async function rotateInviteUrl() {
    if (rotating) return;
    setConfirmingRotate(false);
    setRotating(true);
    setInviteError(null);
    try {
      const response = await fetch('/api/account/invite-token/rotate', {
        method: 'POST',
        credentials: 'include',
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        setInviteError(body?.message ?? 'Could not rotate your link.');
        return;
      }
      const body = (await response.json().catch(() => null)) as InviteTokenResponse | null;
      if (!body?.url) {
        setInviteError('Could not build the new link.');
        return;
      }
      setInviteUrl(body.url);
      setInviteToast('New link generated.');
    } catch {
      setInviteError('Network error. Try again.');
    } finally {
      setRotating(false);
    }
  }

  function addSeedTopicDraft() {
    const topic = seedTopicDraft.trim();
    if (!topic || seedTopics.length >= SEED_TOPIC_CAP) return;
    if (seedTopics.some((existing) => existing.toLowerCase() === topic.toLowerCase())) {
      setSeedTopicDraft('');
      return;
    }
    setSeedTopics([...seedTopics, topic]);
    setSeedTopicDraft('');
    setSeedTopicsSaved(false);
  }

  function removeSeedTopic(topic: string) {
    setSeedTopics(seedTopics.filter((existing) => existing !== topic));
    setSeedTopicsSaved(false);
  }

  async function saveSeedTopics() {
    if (savingTopics) return;
    setSavingTopics(true);
    setSeedTopicsError(null);
    setSeedTopicsSaved(false);
    try {
      const response = await fetch('/api/account/invite-token/topics', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ topics: seedTopics }),
      });
      const body = (await response.json().catch(() => null)) as TopicsResponse | null;
      if (!response.ok) {
        setSeedTopicsError(body?.message ?? 'Could not save your topics.');
        return;
      }
      setSeedTopics(body?.topics ?? seedTopics);
      setSeedTopicsSaved(true);
    } catch {
      setSeedTopicsError('Network error. Try again.');
    } finally {
      setSavingTopics(false);
    }
  }

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

      {inviteUrl ? (
        <section className="rounded-xl border bg-card p-5 text-card-foreground">
          <h3 className="font-serif text-lg font-semibold">Your invite link</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Anyone you share this with can join Joshing and land as your friend.
          </p>
          <input
            type="text"
            readOnly
            value={inviteUrl}
            onFocus={(event) => event.currentTarget.select()}
            className="border-[var(--accent-gold)] bg-[var(--brand-field)] text-foreground mt-3 h-11 w-full rounded-md border px-3 text-sm outline-none focus:border-[var(--brand-navy)]"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void copyInviteUrl()}
              className="btn-primary px-4"
            >
              Copy
            </button>
            {confirmingRotate ? (
              <>
                <button
                  type="button"
                  onClick={() => void rotateInviteUrl()}
                  disabled={rotating}
                  className="btn-danger px-4"
                >
                  {rotating ? 'Rotating…' : 'Rotate — old link stops working'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingRotate(false)}
                  disabled={rotating}
                  className="btn-ghost px-4"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingRotate(true)}
                className="btn-ghost px-4"
              >
                Rotate link
              </button>
            )}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Rotating invalidates the old link. Use this if you accidentally shared it broadly.
          </p>
          {inviteError ? <p className="mt-2 text-sm text-destructive">{inviteError}</p> : null}

          <div className="mt-4 border-t pt-4">
            <h4 className="text-sm font-semibold">Topics your link shows</h4>
            <p className="mt-1 text-xs text-muted-foreground">
              Up to {SEED_TOPIC_CAP} topics shown to whoever taps your link. Leave blank to
              automatically use your own top topics instead.
            </p>
            {seedTopics.length > 0 ? (
              <ul className="mt-2 flex flex-wrap gap-2">
                {seedTopics.map((topic) => (
                  <li
                    key={topic}
                    className="flex items-center gap-1 rounded-full border bg-background px-3 py-1 text-sm"
                  >
                    {topic}
                    <button
                      type="button"
                      onClick={() => removeSeedTopic(topic)}
                      aria-label={`Remove ${topic}`}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {seedTopics.length < SEED_TOPIC_CAP ? (
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={seedTopicDraft}
                  onChange={(event) => setSeedTopicDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    addSeedTopicDraft();
                  }}
                  placeholder="Add a topic"
                  className="border-input bg-background text-foreground h-9 flex-1 rounded-md border px-3 text-sm outline-none focus:border-[var(--brand-navy)]"
                />
                <button type="button" onClick={addSeedTopicDraft} className="btn-ghost px-3">
                  Add
                </button>
              </div>
            ) : null}
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveSeedTopics()}
                disabled={savingTopics}
                className="btn-primary px-4"
              >
                {savingTopics ? 'Saving…' : 'Save topics'}
              </button>
              {seedTopicsSaved ? (
                <span className="text-xs text-muted-foreground">Saved.</span>
              ) : null}
            </div>
            {seedTopicsError ? (
              <p className="mt-2 text-sm text-destructive">{seedTopicsError}</p>
            ) : null}
          </div>
          {inviteToast ? (
            <div className="fixed bottom-24 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
              {inviteToast}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
