'use client'

import { FormEvent, useEffect, useRef, useState } from 'react'

const INTEREST_PLACEHOLDERS = [
  'Sondheim',
  'Mrs. Dalloway',
  '1980s Saturday morning cartoons',
]

const ERROR_COPY: Record<string, string> = {
  invalid_phone: 'Use a US mobile number.',
  too_many_suggested_interests: 'Choose up to three.',
  missing_invitee_display_name: 'Add their name first.',
  invalid_invitee_display_name: 'Use a shorter, real display name.',
  invalid_suggested_interests: 'Keep each idea short and friendly.',
  invite_cooldown:
    'Give this invite a little breathing room before trying again.',
}

type Step = 'identity' | 'interests' | 'handoff'

type InviteResult = {
  ok: boolean
  type: 'friend_invitation' | 'friendship_request'
  id: string
  invitationId?: string | null
  inviteUrl: string | null
  message: string | null
  inviteeDisplayName: string
  inviteePhone: string
  suggestedInterests: string[]
}

type ErrorResponse = {
  error?: string
  message?: string
}

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

function looksLikeUsMobileNumber(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return (
    digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))
  )
}

export default function AddFriendInvite() {
  const [expanded, setExpanded] = useState(false)
  const [step, setStep] = useState<Step>('identity')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [interests, setInterests] = useState(['', '', ''])
  const [result, setResult] = useState<InviteResult | null>(null)
  const [messageText, setMessageText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [copyLabel, setCopyLabel] = useState('Copy message')
  const [submitting, setSubmitting] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement | null>(null)

  const trimmedName = name.trim()
  const smsHref = result?.message
    ? buildSmsHref(result.inviteePhone, messageText)
    : null

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
      setExpanded(true)
      setStep('identity')
      setName(detail?.inviteeDisplayName ?? '')
      setPhone(detail?.phone ?? '')
      setInterests([
        detail?.suggestedInterests?.[0] ?? '',
        detail?.suggestedInterests?.[1] ?? '',
        detail?.suggestedInterests?.[2] ?? '',
      ])
      setResult(null)
      setMessageText('')
      setError(null)
      setCopyLabel('Copy message')
    }

    window.addEventListener('friend-invitations:create-new', prefillInvite)
    return () =>
      window.removeEventListener('friend-invitations:create-new', prefillInvite)
  }, [])

  function resetFlow() {
    setExpanded(false)
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

  function updateInterest(index: number, value: string) {
    setInterests((current) =>
      current.map((interest, i) => (i === index ? value : interest))
    )
    if (error === ERROR_COPY.too_many_suggested_interests) setError(null)
  }

  function goToInterests(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!trimmedName) {
      setError(ERROR_COPY.missing_invitee_display_name)
      return
    }

    if (!looksLikeUsMobileNumber(phone)) {
      setError(ERROR_COPY.invalid_phone)
      return
    }

    setError(null)
    setStep('interests')
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
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
      const body = (await response.json().catch(() => null)) as
        | InviteResult
        | ErrorResponse
        | null

      if (!response.ok || !body || !('ok' in body)) {
        const apiError = body && 'error' in body ? body.error : undefined
        throw new Error(
          apiError
            ? (ERROR_COPY[apiError] ??
                body?.message ??
                'Could not create the invite.')
            : 'Could not create the invite.'
        )
      }

      setResult(body)
      setMessageText(body.message ?? '')
      setStep('handoff')
      window.dispatchEvent(new Event('friend-invitations:refresh'))
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not create the invite.'
      )
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
      if (navigator.share) {
        await navigator.share({ text: messageText })
        sendTelemetry('add_friend_message_copied', {
          invitation_id: result?.invitationId ?? result?.id ?? null,
          suggested_interest_count: result?.suggestedInterests.length ?? 0,
          fallback: 'share',
        })
        return
      }
      messageRef.current?.focus()
      messageRef.current?.select()
      setCopyLabel('Select text')
    }
  }

  if (!expanded) {
    return (
      <section className="bg-card text-card-foreground mb-5 rounded-2xl border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-sm">
        <p className="text-foreground text-sm font-medium">
          Bring a friend into Joshing.
        </p>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Send a warm note with just a few ideas they can keep, edit, or ignore.
        </p>
        <button
          type="button"
          className="btn-primary mt-4 min-h-12 w-full rounded-full"
          onClick={() => {
            sendTelemetry('add_friend_started', { source: 'inline_card' })
            setExpanded(true)
          }}
        >
          Add friend
        </button>
      </section>
    )
  }

  return (
    <section className="bg-card text-card-foreground mb-5 rounded-2xl border p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-sm">
      {step === 'identity' ? (
        <form className="space-y-5" onSubmit={goToInterests}>
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              Add friend
            </p>
            <h2 className="text-foreground mt-2 font-serif text-2xl font-semibold">
              Who came to mind?
            </h2>
          </div>

          <div className="space-y-4">
            <label className="text-foreground block text-sm font-medium">
              Name
              <input
                className="bg-background focus:border-foreground focus:ring-ring mt-2 h-12 w-full rounded-xl border px-3 text-base transition outline-none focus:ring-2"
                value={name}
                onChange={(event) => {
                  setName(event.target.value)
                  if (error === ERROR_COPY.missing_invitee_display_name)
                    setError(null)
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
                className="bg-background focus:border-foreground focus:ring-ring mt-2 h-12 w-full rounded-xl border px-3 text-base transition outline-none focus:ring-2"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value)
                  if (error === ERROR_COPY.invalid_phone) setError(null)
                }}
                autoComplete="tel"
                inputMode="tel"
                placeholder="(555) 123-4567"
                enterKeyHint="next"
              />
            </label>
          </div>

          {error ? (
            <p className="text-destructive text-sm font-medium">{error}</p>
          ) : null}

          <div className="space-y-3">
            <button
              type="submit"
              className="btn-primary min-h-12 w-full rounded-full"
            >
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
        <form className="space-y-5" onSubmit={createInvite}>
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              For {trimmedName}
            </p>
            <h2 className="text-foreground mt-2 font-serif text-2xl font-semibold">
              A few ideas, lightly held
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Add up to three areas that made you think of them. Just a few
              ideas — they can keep, edit, or ignore these.
            </p>
          </div>

          <div className="space-y-4">
            {INTEREST_PLACEHOLDERS.map((placeholder, index) => (
              <label
                key={placeholder}
                className="text-foreground block text-sm font-medium"
              >
                Idea {index + 1}
                <input
                  className="bg-background focus:border-foreground focus:ring-ring mt-2 h-12 w-full rounded-full border px-4 text-base transition outline-none focus:ring-2"
                  value={interests[index] ?? ''}
                  onChange={(event) =>
                    updateInterest(index, event.target.value)
                  }
                  placeholder={placeholder}
                  maxLength={60}
                  enterKeyHint={index === 2 ? 'done' : 'next'}
                />
              </label>
            ))}
          </div>

          {error ? (
            <p className="text-destructive text-sm font-medium">{error}</p>
          ) : null}

          <div className="space-y-3">
            <button
              type="submit"
              className="btn-primary min-h-12 w-full rounded-full"
              disabled={submitting}
            >
              {submitting ? 'Warming it up…' : 'Make the note'}
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

      {step === 'handoff' && result ? (
        <div className="space-y-5">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              {result.type === 'friendship_request'
                ? 'Warm note ready'
                : 'Invite ready'}
            </p>
            <h2 className="text-foreground mt-2 font-serif text-2xl font-semibold">
              {result.type === 'friendship_request'
                ? `Send this to ${result.inviteeDisplayName}.`
                : `Send this to ${result.inviteeDisplayName}.`}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              You’ll send the message yourself — Joshing won’t text them for
              you.
            </p>
          </div>

          {result.suggestedInterests.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {result.suggestedInterests.map((interest) => (
                <span
                  key={interest}
                  className="bg-primary/5 text-foreground border-primary/10 rounded-full border px-3 py-1 text-sm shadow-sm"
                >
                  {interest}
                </span>
              ))}
            </div>
          ) : (
            <p className="bg-muted text-muted-foreground rounded-xl px-3 py-2 text-sm">
              No ideas attached this time — just a simple invitation.
            </p>
          )}

          <label className="text-foreground block text-sm font-medium">
            Message you can send
            <textarea
              ref={messageRef}
              className="bg-background focus:border-foreground focus:ring-ring mt-2 min-h-36 w-full rounded-xl border p-3 text-base leading-6 transition outline-none focus:ring-2"
              value={messageText}
              onChange={(event) => setMessageText(event.target.value)}
            />
          </label>

          {!messageText.includes(result.inviteUrl ?? '') ? (
            <p className="text-destructive text-sm">
              Keep the link in your note so they have somewhere to land.
            </p>
          ) : null}

          <div className="space-y-3">
            <button
              type="button"
              className="btn-primary min-h-12 w-full rounded-full"
              onClick={copyMessage}
            >
              {copyLabel}
            </button>
            {smsHref ? (
              <a
                className="btn-ghost min-h-12 w-full rounded-full"
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
            <button
              type="button"
              className="text-muted-foreground w-full py-2 text-sm"
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
