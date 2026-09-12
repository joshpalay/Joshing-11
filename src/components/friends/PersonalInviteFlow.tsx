'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'

import { Chip } from '@/components/ui/Chip'
import { formatUsPhoneInput, looksLikeUsPhone } from '@/lib/phone-e164'

const INTEREST_PLACEHOLDERS = ['Sondheim', 'Mrs. Dalloway', '1980s Saturday morning cartoons']

const ERROR_COPY: Record<string, string> = {
  invalid_phone: 'Use a US mobile number.',
  too_many_suggested_interests: 'Choose up to three.',
  missing_invitee_display_name: 'Add their name first.',
  invalid_invitee_display_name: 'Use a shorter, real display name.',
  invalid_suggested_interests: 'Keep each idea short and friendly.',
  invite_cooldown: 'Give this invite a little breathing room before trying again.',
}

type Step = 'identity' | 'interests' | 'handoff'

// When the invited phone already belongs to a Joshing account, the invite is
// converted server-side into a follow request. `state` reports what happened
// so the handoff screen can speak plainly instead of pretending an SMS invite
// went out (see POST /api/friend-invitations).
type FriendshipRequestState = 'created' | 'auto_approved' | 'already_following' | 'pending_existing'

type InviteResult = {
  ok: boolean
  type: 'friend_invitation' | 'friendship_request'
  state?: FriendshipRequestState
  id: string
  invitationId?: string | null
  inviteUrl: string | null
  message: string | null
  inviteeDisplayName: string
  inviteePhone: string
  suggestedInterests: string[]
}

// Per-state copy for the handoff step when we matched an existing account.
// `needsNudge` decides whether the message/SMS handoff is still meaningful: a
// pending request can be nudged along, but an auto-approved or already-existing
// follow is terminal -- there's nothing to send.
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
}

type ErrorResponse = { error?: string; message?: string }

function normalizeInterestList(interests: string[]) {
  return interests.map((interest) => interest.trim()).filter(Boolean)
}

function buildSmsHref(phone: string, message: string) {
  return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(message)}`
}

function sendTelemetry(event: string, metadata: Record<string, unknown> = {}) {
  void fetch('/api/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ event, metadata }),
    keepalive: true,
  }).catch(() => undefined)
}

// Standalone "send a personal invite" flow: texts a specific phone number,
// with optional ideas attached. Distinct from the generic shareable link in
// InviteLinksSection. Always mounted at #personal-invite so other surfaces
// (FindFriendsSearch's no-match state, a "fresh note" resend) can link or
// dispatch straight into it via the friend-invitations:create-new event; on
// success it dispatches friend-invitations:refresh, which FriendsList's
// "Waiting for Response" section already listens for.
export function PersonalInviteFlow() {
  const [step, setStep] = useState<Step>('identity')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [interests, setInterests] = useState(['', '', ''])
  const [result, setResult] = useState<InviteResult | null>(null)
  const [messageText, setMessageText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copyLabel, setCopyLabel] = useState('Copy message')
  const [submitting, setSubmitting] = useState(false)
  const [contactsSupported, setContactsSupported] = useState<boolean | null>(null)
  const [isIos, setIsIos] = useState(false)
  const sectionRef = useRef<HTMLElement | null>(null)
  const nameRef = useRef<HTMLInputElement | null>(null)
  const messageRef = useRef<HTMLTextAreaElement | null>(null)

  const trimmedName = name.trim()
  const smsHref = result?.message ? buildSmsHref(result.inviteePhone, messageText) : null
  const friendshipCopy =
    result?.type === 'friendship_request' ? FRIENDSHIP_STATE_COPY[result.state ?? 'created'] : null
  const showMessageHandoff = !friendshipCopy || friendshipCopy.needsNudge

  function resetFlow() {
    setStep('identity')
    setName('')
    setPhone('')
    setInterests(['', '', ''])
    setResult(null)
    setMessageText('')
    setError(null)
    setCopyLabel('Copy message')
    setSubmitting(false)
  }

  useEffect(() => {
    function prefillInvite(event: Event) {
      const detail = (
        event as CustomEvent<{
          inviteeDisplayName?: string
          phone?: string
          suggestedInterests?: string[]
        }>
      ).detail

      sendTelemetry('add_friend_started', { source: 'custom_event' })
      setStep('identity')
      setName(detail?.inviteeDisplayName ?? '')
      setPhone(formatUsPhoneInput(detail?.phone ?? ''))
      setInterests([
        detail?.suggestedInterests?.[0] ?? '',
        detail?.suggestedInterests?.[1] ?? '',
        detail?.suggestedInterests?.[2] ?? '',
      ])
      setResult(null)
      setMessageText('')
      setError(null)
      setCopyLabel('Copy message')
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      nameRef.current?.focus({ preventScroll: true })
    }

    window.addEventListener('friend-invitations:create-new', prefillInvite)
    return () => window.removeEventListener('friend-invitations:create-new', prefillInvite)
  }, [])

  useEffect(() => {
    void (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent)
      if (!('contacts' in navigator) || !('ContactsManager' in window)) {
        setIsIos(ios)
        setContactsSupported(false)
        return
      }
      try {
        const props = await navigator.contacts!.getProperties()
        setIsIos(ios)
        setContactsSupported(props.includes('name') && props.includes('tel'))
      } catch {
        setIsIos(ios)
        setContactsSupported(false)
      }
    })()
  }, [])

  async function pickContact() {
    try {
      const results = await navigator.contacts!.select(['name', 'tel'], { multiple: false })
      if (!results.length) return
      const contact = results[0]
      const pickedName = (contact.name ?? []).filter(Boolean).join(' ').trim()
      const pickedTel = (contact.tel ?? []).find(looksLikeUsPhone) ?? null
      if (!pickedTel) {
        setError('That contact has no US mobile number. Try another, or type one in.')
        return
      }
      if (pickedName) setName(pickedName)
      setPhone(formatUsPhoneInput(pickedTel))
      setError(null)
    } catch {
      setError('Could not open contacts. You can type the number instead.')
    }
  }

  function updateInterest(index: number, value: string) {
    setInterests((current) => current.map((interest, i) => (i === index ? value : interest)))
    if (error === ERROR_COPY.too_many_suggested_interests) setError(null)
  }

  function goToInterests(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmedName) {
      setError(ERROR_COPY.missing_invitee_display_name)
      return
    }
    if (!looksLikeUsPhone(phone)) {
      setError(ERROR_COPY.invalid_phone)
      return
    }
    setError(null)
    setStep('interests')
  }

  async function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const currentInterests = normalizeInterestList(interests)
    if (currentInterests.length > 3) {
      setError(ERROR_COPY.too_many_suggested_interests)
      return
    }

    setSubmitting(true)
    setError(null)

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
      })
      const body = (await response.json().catch(() => null)) as InviteResult | ErrorResponse | null

      if (!response.ok || !body || !('ok' in body)) {
        const apiError = body && 'error' in body ? body.error : undefined
        throw new Error(
          apiError ? (ERROR_COPY[apiError] ?? body?.message ?? 'Could not create the invite.') : 'Could not create the invite.'
        )
      }

      setResult(body)
      setMessageText(body.message ?? '')
      setStep('handoff')
      window.dispatchEvent(new Event('friend-invitations:refresh'))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create the invite.')
    } finally {
      setSubmitting(false)
    }
  }

  async function copyMessage() {
    if (!messageText) return

    try {
      await navigator.clipboard.writeText(messageText)
      setCopyLabel('Copied ✓')
      sendTelemetry('add_friend_message_copied', {
        invitation_id: result?.invitationId ?? result?.id ?? null,
        suggested_interest_count: result?.suggestedInterests.length ?? 0,
      })
      window.setTimeout(() => setCopyLabel('Copy message'), 2000)
    } catch {
      messageRef.current?.focus()
      messageRef.current?.select()
      setCopyLabel('Select text')
    }
  }

  return (
    <section
      ref={sectionRef}
      id="personal-invite"
      className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]"
    >
      {step === 'identity' ? (
        <form className="space-y-5" onSubmit={goToInterests}>
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              Personal invite
            </p>
            <h2 className="text-foreground mt-2 font-serif text-2xl font-semibold">Who came to mind?</h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Text them yourself — no app to download, no account required to receive it.
            </p>
          </div>

          {contactsSupported ? (
            <button type="button" onClick={pickContact} className="btn-ghost w-full">
              Pick from contacts
            </button>
          ) : null}

          <div className="space-y-4">
            <label className="text-foreground block text-sm font-medium">
              Name
              <input
                ref={nameRef}
                className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] mt-2 h-12 w-full rounded-xl border border-[var(--accent-gold)] px-3 text-base transition outline-none"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (error === ERROR_COPY.missing_invitee_display_name) setError(null)
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
                  setPhone(formatUsPhoneInput(event.target.value))
                  if (error === ERROR_COPY.invalid_phone) setError(null)
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
                Tip: tap the name or phone field and use the suggestion above your keyboard to pull from
                Contacts.
              </p>
            ) : null}
          </div>

          {error ? <p className="text-destructive text-sm font-medium">{error}</p> : null}

          <button type="submit" className="btn-primary w-full">
            Next
          </button>
        </form>
      ) : null}

      {step === 'interests' ? (
        <form className="space-y-5" onSubmit={submitInvite}>
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
                  className="bg-[var(--brand-field)] focus:border-[var(--brand-navy)] mt-2 h-12 w-full rounded-xl border border-[var(--accent-gold)] px-4 text-base transition outline-none"
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
            <button type="submit" className="btn-primary w-full" disabled={submitting}>
              {submitting ? 'Warming it up…' : 'Make the note'}
            </button>
            <button type="button" className="btn-ghost w-full" onClick={() => setStep('identity')}>
              Back
            </button>
          </div>
        </form>
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
                <Chip key={interest} variant="outline" className="bg-primary/5">
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
                <button type="button" className="btn-primary w-full" onClick={() => void copyMessage()}>
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
              className={showMessageHandoff ? 'btn-ghost w-full' : 'btn-primary w-full'}
              onClick={resetFlow}
            >
              Done
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
