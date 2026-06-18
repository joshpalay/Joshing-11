'use client';

import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';

import { Chip } from '@/components/ui/Chip';
import { formatUsPhoneInput } from '@/lib/phone-e164';

const INTEREST_PLACEHOLDERS = ['Sondheim', 'Mrs. Dalloway', '1980s Saturday morning cartoons'];

const ERROR_COPY: Record<string, string> = {
  invalid_phone: 'Use a US mobile number.',
  too_many_suggested_interests: 'Choose up to three.',
  missing_invitee_display_name: 'Add their name first.',
  invalid_invitee_display_name: 'Use a shorter, real display name.',
  invalid_suggested_interests: 'Keep each idea short and friendly.',
  invite_cooldown: 'Give this invite a little breathing room before trying again.',
};

type Step = 'identity' | 'interests' | 'review' | 'handoff';

// One proofread outcome from POST /api/friend-invitations/review: the idea as
// typed plus a spelling correction when one was found (else null).
type ProofreadResult = {
  original: string;
  suggestion: string | null;
};

// When the invited phone already belongs to a Joshing account, the invite is
// converted server-side into a follow request. `state` reports what happened so
// the handoff screen can speak plainly instead of pretending an SMS invite went
// out (see POST /api/friend-invitations).
type FriendshipRequestState =
  | 'created'
  | 'auto_approved'
  | 'already_following'
  | 'pending_existing';

type InviteResult = {
  ok: boolean;
  type: 'friend_invitation' | 'friendship_request';
  state?: FriendshipRequestState;
  id: string;
  invitationId?: string | null;
  inviteUrl: string | null;
  message: string | null;
  inviteeDisplayName: string;
  inviteePhone: string;
  suggestedInterests: string[];
};

// Per-state copy for the handoff step when we matched an existing account.
// `needsNudge` decides whether the message/SMS handoff is still meaningful: a
// pending request can be nudged along, but an auto-approved or already-existing
// follow is terminal — there's nothing to send.
const FRIENDSHIP_STATE_COPY: Record<
  FriendshipRequestState,
  { eyebrow: string; headline: (name: string) => string; blurb: string; needsNudge: boolean }
> = {
  created: {
    eyebrow: 'Already on Joshing',
    headline: (name) => `${name} is already on Joshing.`,
    blurb:
      'We turned your invite into a friend request. They’ll see it — and the areas you flagged — in their activity. Want to nudge them?',
    needsNudge: true,
  },
  pending_existing: {
    eyebrow: 'Request still pending',
    headline: (name) => `You’ve already sent ${name} a friend request.`,
    blurb: 'Your earlier request is still waiting for them. Send a gentle nudge if you’d like.',
    needsNudge: true,
  },
  auto_approved: {
    eyebrow: 'You’re connected',
    headline: (name) => `You’re now friends with ${name}.`,
    blurb: 'Their profile is open, so you’re already connected — nothing to send.',
    needsNudge: false,
  },
  already_following: {
    eyebrow: 'Already friends',
    headline: (name) => `You’re already friends with ${name}.`,
    blurb: 'You’re connected — nothing else to do here.',
    needsNudge: false,
  },
};

type ErrorResponse = {
  error?: string;
  message?: string;
};

function normalizeInterestList(interests: string[]) {
  return interests.map((interest) => interest.trim()).filter(Boolean);
}

function buildSmsHref(phone: string, message: string) {
  return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(message)}`;
}

function sendTelemetry(event: string, metadata: Record<string, unknown> = {}) {
  void fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ event, metadata }),
    keepalive: true,
  }).catch(() => undefined);
}

function looksLikeUsMobileNumber(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

type AddFriendInviteProps = {
  embedded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
};

export default function AddFriendInvite({
  embedded = false,
  onExpandedChange,
}: AddFriendInviteProps = {}) {
  const [expanded, setExpanded] = useState(false);
  const [step, setStep] = useState<Step>('identity');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [interests, setInterests] = useState(['', '', '']);
  const [result, setResult] = useState<InviteResult | null>(null);
  const [messageText, setMessageText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copyLabel, setCopyLabel] = useState('Copy message');
  const [submitting, setSubmitting] = useState(false);
  const [checking, setChecking] = useState(false);
  // The normalized ideas being confirmed on the review step, plus the proofread
  // corrections aligned to them by index. reviewIdeas[i] holds the inviter's
  // current pick (typed label or accepted suggestion).
  const [reviewIdeas, setReviewIdeas] = useState<string[]>([]);
  const [proofread, setProofread] = useState<ProofreadResult[]>([]);
  const [contactsSupported, setContactsSupported] = useState<boolean | null>(null);
  const [isIos, setIsIos] = useState(false);
  const messageRef = useRef<HTMLTextAreaElement | null>(null);

  const trimmedName = name.trim();
  const smsHref = result?.message ? buildSmsHref(result.inviteePhone, messageText) : null;
  // Resolve the existing-account handoff copy (null for a brand-new SMS invite).
  const friendshipCopy =
    result?.type === 'friendship_request'
      ? FRIENDSHIP_STATE_COPY[result.state ?? 'created']
      : null;
  // The message/SMS handoff only makes sense for a fresh invite or a pending
  // request that can still be nudged — not for an already-settled follow.
  const showMessageHandoff = !friendshipCopy || friendshipCopy.needsNudge;

  useEffect(() => {
    function prefillInvite(event: Event) {
      const detail = (
        event as CustomEvent<{
          inviteeDisplayName?: string;
          phone?: string;
          suggestedInterests?: string[];
        }>
      ).detail;

      sendTelemetry('add_friend_started', { source: 'custom_event' });
      setExpanded(true);
      onExpandedChange?.(true);
      setStep('identity');
      setName(detail?.inviteeDisplayName ?? '');
      setPhone(detail?.phone ?? '');
      setInterests([
        detail?.suggestedInterests?.[0] ?? '',
        detail?.suggestedInterests?.[1] ?? '',
        detail?.suggestedInterests?.[2] ?? '',
      ]);
      setResult(null);
      setMessageText('');
      setError(null);
      setCopyLabel('Copy message');
      setReviewIdeas([]);
      setProofread([]);
    }

    window.addEventListener('friend-invitations:create-new', prefillInvite);
    return () => window.removeEventListener('friend-invitations:create-new', prefillInvite);
  }, [onExpandedChange]);

  useEffect(() => {
    void (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      if (!('contacts' in navigator) || !('ContactsManager' in window)) {
        setIsIos(ios);
        setContactsSupported(false);
        return;
      }
      try {
        const props = await navigator.contacts!.getProperties();
        setIsIos(ios);
        setContactsSupported(props.includes('name') && props.includes('tel'));
      } catch {
        setIsIos(ios);
        setContactsSupported(false);
      }
    })();
  }, []);

  async function pickContact() {
    sendTelemetry('contact_picker_opened', {});
    try {
      const results = await navigator.contacts!.select(['name', 'tel'], {
        multiple: false,
      });
      if (!results.length) {
        sendTelemetry('contact_picker_cancelled', {});
        return;
      }
      const contact = results[0];
      const pickedName = (contact.name ?? []).filter(Boolean).join(' ').trim();
      const pickedTel = (contact.tel ?? []).find(looksLikeUsMobileNumber) ?? null;
      if (!pickedTel) {
        setError('That contact has no US mobile number. Try another, or type one in.');
        sendTelemetry('contact_picker_no_us_tel', {
          had_name: Boolean(pickedName),
        });
        return;
      }
      if (pickedName) setName(pickedName);
      setPhone(pickedTel);
      setError(null);
      sendTelemetry('contact_picker_selected', {
        had_name: Boolean(pickedName),
        tel_count: contact.tel?.length ?? 0,
      });
    } catch (err) {
      setError('Could not open contacts. You can type the number instead.');
      sendTelemetry('contact_picker_error', {
        message: err instanceof Error ? err.message : 'unknown',
      });
    }
  }

  function resetFlow() {
    setExpanded(false);
    onExpandedChange?.(false);
    setStep('identity');
    setName('');
    setPhone('');
    setInterests(['', '', '']);
    setResult(null);
    setMessageText('');
    setError(null);
    setCopyLabel('Copy message');
    setSubmitting(false);
    setChecking(false);
    setReviewIdeas([]);
    setProofread([]);
  }

  function updateInterest(index: number, value: string) {
    setInterests((current) => current.map((interest, i) => (i === index ? value : interest)));
    if (error === ERROR_COPY.too_many_suggested_interests) setError(null);
  }

  function goToInterests(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!trimmedName) {
      setError(ERROR_COPY.missing_invitee_display_name);
      return;
    }

    if (!looksLikeUsMobileNumber(phone)) {
      setError(ERROR_COPY.invalid_phone);
      return;
    }

    setError(null);
    setStep('interests');
  }

  // Step 2 submit: proofread the typed ideas for spelling typos first. If any
  // come back with a suggested fix, route to the review step so the inviter can
  // confirm or correct; otherwise create the invite straight away. Proofreading
  // is best-effort — any failure falls through to creating the invite as typed.
  async function reviewAndCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const currentInterests = normalizeInterestList(interests);

    if (currentInterests.length > 3) {
      setError(ERROR_COPY.too_many_suggested_interests);
      return;
    }

    if (currentInterests.length === 0) {
      await submitInvite([]);
      return;
    }

    setChecking(true);
    setError(null);

    let corrections: ProofreadResult[] = [];
    try {
      const response = await fetch('/api/friend-invitations/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ interests: currentInterests }),
      });
      const body = (await response.json().catch(() => null)) as { results?: ProofreadResult[] } | null;
      if (response.ok && body && Array.isArray(body.results)) {
        corrections = body.results;
      }
    } catch {
      corrections = [];
    } finally {
      setChecking(false);
    }

    if (corrections.some((item) => item.suggestion)) {
      setReviewIdeas(currentInterests);
      setProofread(corrections);
      setStep('review');
      return;
    }

    await submitInvite(currentInterests);
  }

  // Apply (or undo) a proofread suggestion for one idea on the review step.
  function chooseIdea(index: number, value: string) {
    setReviewIdeas((current) => current.map((idea, i) => (i === index ? value : idea)));
  }

  async function submitInvite(currentInterests: string[]) {
    if (currentInterests.length > 3) {
      setError(ERROR_COPY.too_many_suggested_interests);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch('/api/friend-invitations', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          inviteeDisplayName: trimmedName,
          phone,
          suggestedInterests: currentInterests,
        }),
      });
      const body = (await response.json().catch(() => null)) as InviteResult | ErrorResponse | null;

      if (!response.ok || !body || !('ok' in body)) {
        const apiError = body && 'error' in body ? body.error : undefined;
        throw new Error(
          apiError
            ? (ERROR_COPY[apiError] ?? body?.message ?? 'Could not create the invite.')
            : 'Could not create the invite.',
        );
      }

      setResult(body);
      setMessageText(body.message ?? '');
      setStep('handoff');
      window.dispatchEvent(new Event('friend-invitations:refresh'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the invite.');
    } finally {
      setSubmitting(false);
    }
  }

  async function copyMessage() {
    if (!messageText) return;

    try {
      await navigator.clipboard.writeText(messageText);
      setCopyLabel('Copied ✓');
      sendTelemetry('add_friend_message_copied', {
        invitation_id: result?.invitationId ?? result?.id ?? null,
        suggested_interest_count: result?.suggestedInterests.length ?? 0,
      });
      window.setTimeout(() => setCopyLabel('Copy message'), 2000);
    } catch {
      if (navigator.share) {
        await navigator.share({ text: messageText });
        sendTelemetry('add_friend_message_copied', {
          invitation_id: result?.invitationId ?? result?.id ?? null,
          suggested_interest_count: result?.suggestedInterests.length ?? 0,
          fallback: 'share',
        });
        return;
      }
      messageRef.current?.focus();
      messageRef.current?.select();
      setCopyLabel('Select text');
    }
  }

  if (!expanded) {
    return null;
  }

  const inviteContent: ReactNode = (
    <>
      {step === 'identity' ? (
        <form className="space-y-5" onSubmit={goToInterests}>
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              Invite Someone
            </p>
            <h2 className="text-foreground mt-2 font-serif text-2xl font-semibold">
              Who came to mind?
            </h2>
          </div>

          {contactsSupported ? (
            <button
              type="button"
              onClick={pickContact}
              className="btn-ghost w-full"
            >
              Pick from contacts
            </button>
          ) : null}

          <div className="space-y-4">
            <label className="text-foreground block text-sm font-medium">
              Name
              <input
                className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] mt-2 h-12 w-full rounded-xl border border-[var(--accent-gold)] px-3 text-base transition outline-none"
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error === ERROR_COPY.missing_invitee_display_name) setError(null);
                }}
                autoComplete="name"
                placeholder="Their name"
                maxLength={60}
                enterKeyHint="next"
              />
            </label>
            <label className="text-foreground block text-sm font-medium">
              Phone number
              <input
                className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] mt-2 h-12 w-full rounded-xl border border-[var(--accent-gold)] px-3 text-base transition outline-none"
                value={phone}
                onChange={(event) => {
                  setPhone(formatUsPhoneInput(event.target.value));
                  if (error === ERROR_COPY.invalid_phone) setError(null);
                }}
                autoComplete="tel"
                inputMode="tel"
                maxLength={14}
                placeholder="(555) 123-4567"
                enterKeyHint="next"
              />
            </label>
            {isIos ? (
              <p className="text-muted-foreground text-xs leading-5">
                Tip: tap the name or phone field and use the suggestion above your keyboard to pull
                from Contacts.
              </p>
            ) : null}
          </div>

          {error ? <p className="text-destructive text-sm font-medium">{error}</p> : null}

          <div className="space-y-3">
            <button type="submit" className="btn-primary w-full">
              Next
            </button>
            <button
              type="button"
              className="text-muted-foreground w-full py-2 text-sm"
              onClick={resetFlow}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {step === 'interests' ? (
        <form className="space-y-5" onSubmit={reviewAndCreate}>
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              For {trimmedName}
            </p>
            <h2 className="text-foreground mt-2 font-serif text-2xl font-semibold">
              A few ideas, lightly held
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Add up to three areas that made you think of them. Just a few ideas — they can keep,
              edit, or ignore these.
            </p>
          </div>

          <div className="space-y-4">
            {INTEREST_PLACEHOLDERS.map((placeholder, index) => (
              <label key={placeholder} className="text-foreground block text-sm font-medium">
                Idea {index + 1}
                <input
                  className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] mt-2 h-12 w-full rounded-full border border-[var(--accent-gold)] px-4 text-base transition outline-none"
                  value={interests[index] ?? ''}
                  onChange={(event) => updateInterest(index, event.target.value)}
                  placeholder={placeholder}
                  maxLength={60}
                  enterKeyHint={index === 2 ? 'done' : 'next'}
                />
              </label>
            ))}
          </div>

          {error ? <p className="text-destructive text-sm font-medium">{error}</p> : null}

          <div className="space-y-3">
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={submitting || checking}
            >
              {checking ? 'Double-checking…' : submitting ? 'Warming it up…' : 'Make the note'}
            </button>
            <button
              type="button"
              className="text-muted-foreground w-full text-sm"
              onClick={() => setStep('identity')}
            >
              Back
            </button>
          </div>
        </form>
      ) : null}

      {step === 'review' ? (
        <div className="space-y-5">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              For {trimmedName}
            </p>
            <h2 className="text-foreground mt-2 font-serif text-2xl font-semibold">
              Double-check these spellings
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              A couple of these look like typos. Pick the spelling you meant, or keep yours.
            </p>
          </div>

          <div className="space-y-4">
            {reviewIdeas.map((idea, index) => {
              const suggestion = proofread[index]?.suggestion ?? null;
              const original = proofread[index]?.original ?? idea;
              if (!suggestion) {
                return (
                  <div key={`${original}-${index}`} className="text-foreground text-sm">
                    <Chip className="bg-primary/5 border border-primary/10 px-3 text-sm shadow-sm">
                      {idea}
                    </Chip>
                  </div>
                );
              }
              const keptOriginal = idea === original;
              return (
                <div key={`${original}-${index}`} className="space-y-2">
                  <p className="text-muted-foreground text-sm">
                    Did you mean <span className="text-foreground font-medium">{suggestion}</span>?
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => chooseIdea(index, suggestion)}
                      className={`rounded-full border px-3 py-1 text-sm transition ${
                        !keptOriginal
                          ? 'border-[var(--brand-navy)] bg-[var(--brand-navy)] text-[var(--cream)]'
                          : 'border-[var(--accent-gold)] bg-[var(--brand-field)] text-foreground'
                      }`}
                    >
                      {suggestion}
                    </button>
                    <button
                      type="button"
                      onClick={() => chooseIdea(index, original)}
                      className={`rounded-full border px-3 py-1 text-sm transition ${
                        keptOriginal
                          ? 'border-[var(--brand-navy)] bg-[var(--brand-navy)] text-[var(--cream)]'
                          : 'border-[var(--accent-gold)] bg-[var(--brand-field)] text-foreground'
                      }`}
                    >
                      Keep “{original}”
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {error ? <p className="text-destructive text-sm font-medium">{error}</p> : null}

          <div className="space-y-3">
            <button
              type="button"
              className="btn-primary w-full"
              disabled={submitting}
              onClick={() => void submitInvite(normalizeInterestList(reviewIdeas))}
            >
              {submitting ? 'Warming it up…' : 'Looks good — make the note'}
            </button>
            <button
              type="button"
              className="text-muted-foreground w-full text-sm"
              onClick={() => {
                setError(null);
                setStep('interests');
              }}
            >
              Back to edit
            </button>
          </div>
        </div>
      ) : null}

      {step === 'handoff' && result ? (
        <div className="space-y-5">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              {friendshipCopy ? friendshipCopy.eyebrow : 'Invite ready'}
            </p>
            <h2 className="text-foreground mt-2 font-serif text-2xl font-semibold">
              {friendshipCopy
                ? friendshipCopy.headline(result.inviteeDisplayName)
                : `Send this to ${result.inviteeDisplayName}.`}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {friendshipCopy
                ? friendshipCopy.blurb
                : 'You’ll send the message yourself — Joshing won’t text them for you.'}
            </p>
          </div>

          {result.suggestedInterests.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {result.suggestedInterests.map((interest) => (
                <Chip
                  key={interest}
                  className="bg-primary/5 border border-primary/10 px-3 text-sm shadow-sm"
                >
                  {interest}
                </Chip>
              ))}
            </div>
          ) : !friendshipCopy ? (
            <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm">
              No ideas attached this time — just a simple invitation.
            </p>
          ) : null}

          {showMessageHandoff ? (
            <>
              <label className="text-foreground block text-sm font-medium">
                Message you can send
                <textarea
                  ref={messageRef}
                  className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] mt-2 min-h-36 w-full rounded-xl border border-[var(--accent-gold)] p-3 text-base leading-6 transition outline-none"
                  value={messageText}
                  onChange={(event) => setMessageText(event.target.value)}
                />
              </label>

              {!messageText.includes(result.inviteUrl ?? '') ? (
                <p className="text-destructive text-sm">
                  Keep the link in your note so they have somewhere to land.
                </p>
              ) : null}
            </>
          ) : null}

          <div className="space-y-3">
            {showMessageHandoff ? (
              <>
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={copyMessage}
                >
                  {copyLabel}
                </button>
                {smsHref ? (
                  <a
                    className="btn-ghost w-full"
                    href={smsHref}
                    onClick={() =>
                      sendTelemetry('add_friend_sms_handoff_opened', {
                        invitation_id: result.invitationId ?? result.id,
                        suggested_interest_count: result.suggestedInterests.length,
                        invite_type: result.type,
                      })
                    }
                  >
                    Open Messages
                  </a>
                ) : null}
              </>
            ) : null}
            <button
              type="button"
              className={
                showMessageHandoff
                  ? 'text-muted-foreground w-full py-2 text-sm'
                  : 'btn-primary w-full'
              }
              onClick={resetFlow}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </>
  );

  if (embedded) {
    return <div className="pb-[max(0rem,env(safe-area-inset-bottom))]">{inviteContent}</div>;
  }

  return (
    <section className="bg-card text-card-foreground mb-5 rounded-[var(--radius-card)] border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--shadow-card)]">
      {inviteContent}
    </section>
  );
}
