'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'

type FriendOption = {
  id: string
  displayName: string
  declaredInterests?: string[]
}

type InviteResult = {
  ok: true
  type?: 'friend_invitation' | 'friendship_request'
  state?: string
  inviteUrl?: string | null
  message?: string | null
  inviteeDisplayName: string
  inviteePhone: string
  suggestedInterests: string[]
}

type ErrorResponse = { error?: string; message?: string }

type Props = {
  domain: string
  onClose: () => void
}

function normalizeInterestList(values: string[]) {
  const seen = new Set<string>()
  const result: string[] = []

  for (const value of values) {
    const normalized = value.trim().replace(/\s+/g, ' ')
    if (!normalized) continue
    const key = normalized.toLocaleLowerCase('en-US')
    if (seen.has(key)) continue
    seen.add(key)
    result.push(normalized)
    if (result.length === 3) break
  }

  return result
}

function looksLikeUsPhone(phone: string) {
  const digits = phone.replace(/\D/g, '')
  return (
    digits.length === 10 || (digits.length === 11 && digits.startsWith('1'))
  )
}

function buildDomainAskMessage(domain: string, inviteUrl?: string | null) {
  const base = `Josh is going deep on ${domain} — and thinks you might be the one to stump them.`
  const ask = `If you have a good ${domain} question, send one their way in Joshing.`
  return inviteUrl ? `${base} ${ask} ${inviteUrl}` : `${base} ${ask}`
}

function buildSmsHref(phone: string, message: string) {
  return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(message)}`
}

export function AskFriendForDomain({ domain, onClose }: Props) {
  const [friends, setFriends] = useState<FriendOption[]>([])
  const [loadingFriends, setLoadingFriends] = useState(true)
  const [mode, setMode] = useState<'friend' | 'new'>('friend')
  const [selectedFriend, setSelectedFriend] = useState<FriendOption | null>(
    null
  )
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [interests, setInterests] = useState([domain, '', ''])
  const [result, setResult] = useState<InviteResult | null>(null)
  const [handoffMessage, setHandoffMessage] = useState('')
  const [copyLabel, setCopyLabel] = useState('Copy message')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const messageRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    let active = true
    fetch('/api/friends', { cache: 'no-store', credentials: 'include' })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as {
          friends?: FriendOption[]
          message?: string
        } | null
        if (!response.ok || !body?.friends)
          throw new Error(body?.message ?? 'Could not load friends.')
        if (active) {
          setFriends(body.friends)
          if (body.friends.length === 0) setMode('new')
        }
      })
      .catch((caught) => {
        if (active) {
          setError(
            caught instanceof Error ? caught.message : 'Could not load friends.'
          )
          setMode('new')
        }
      })
      .finally(() => {
        if (active) setLoadingFriends(false)
      })

    return () => {
      active = false
    }
  }, [])

  const normalizedInterests = useMemo(
    () => normalizeInterestList(interests),
    [interests]
  )
  const smsHref =
    result?.inviteePhone && handoffMessage
      ? buildSmsHref(result.inviteePhone, handoffMessage)
      : null

  function chooseFriend(friend: FriendOption) {
    setSelectedFriend(friend)
    setHandoffMessage(buildDomainAskMessage(domain))
    setResult(null)
    setError(null)
  }

  function updateInterest(index: number, value: string) {
    if (index === 0) return
    setInterests((current) =>
      current.map((interest, i) => (i === index ? value : interest))
    )
  }

  async function createInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required.')
      return
    }
    if (!looksLikeUsPhone(phone)) {
      setError('US phone number required.')
      return
    }

    setSubmitting(true)
    setError(null)

    try {
      const response = await fetch('/api/friend-invitations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          inviteeDisplayName: trimmedName,
          phone,
          suggestedInterests: normalizedInterests,
        }),
      })
      const body = (await response.json().catch(() => null)) as
        | InviteResult
        | ErrorResponse
        | null
      if (!response.ok || !body || !('ok' in body)) {
        throw new Error(body?.message ?? 'Could not create that ask.')
      }

      setResult(body)
      setHandoffMessage(buildDomainAskMessage(domain, body.inviteUrl))
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not create that ask.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  async function copyMessage() {
    if (!handoffMessage) return
    try {
      await navigator.clipboard.writeText(handoffMessage)
      setCopyLabel('Copied ✓')
      window.setTimeout(() => setCopyLabel('Copy message'), 1800)
    } catch {
      messageRef.current?.focus()
      messageRef.current?.select()
      setCopyLabel('Select text')
    }
  }

  const showingHandoff = Boolean(selectedFriend || result)
  const handoffName =
    selectedFriend?.displayName ?? result?.inviteeDisplayName ?? 'your friend'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end bg-black/35 p-0 sm:items-center sm:justify-center sm:p-4"
      role="dialog"
      aria-modal="true"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <section className="bg-background relative max-h-[92dvh] w-full overflow-y-auto rounded-t-2xl border p-5 shadow-xl sm:max-w-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
              Ask someone
            </p>
            <h2 className="mt-2 font-serif text-3xl font-semibold">
              Ask a friend about {domain}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              Suggested interests start with {domain}. Add up to two more if
              they fit; they can keep, edit, or ignore them.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex size-10 items-center justify-center rounded-md border"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        </div>

        {showingHandoff ? (
          <div className="mt-6 space-y-4">
            <div className="bg-card rounded-xl border p-4">
              <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
                For {handoffName}
              </p>
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                This is a lightweight ask — no pressure, no forced interest, and
                no empty round.
              </p>
              <label className="mt-4 block text-sm font-medium">
                Message
                <textarea
                  ref={messageRef}
                  className="bg-background focus:border-foreground mt-2 min-h-32 w-full rounded-xl border p-3 text-sm leading-6 outline-none"
                  value={handoffMessage}
                  onChange={(event) => setHandoffMessage(event.target.value)}
                />
              </label>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                className="btn-primary min-h-12 flex-1 rounded-full"
                onClick={() => void copyMessage()}
              >
                {copyLabel}
              </button>
              {smsHref ? (
                <a
                  className="btn-ghost min-h-12 flex-1 rounded-full"
                  href={smsHref}
                >
                  Open Messages
                </a>
              ) : null}
              <button
                type="button"
                className="text-muted-foreground min-h-12 px-4 text-sm"
                onClick={onClose}
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-card mt-6 grid rounded-full border p-1 text-sm font-medium">
              <div className="grid grid-cols-2">
                <button
                  type="button"
                  className={`min-h-11 rounded-full transition ${mode === 'friend' ? 'bg-foreground text-background' : 'text-muted-foreground'}`}
                  onClick={() => setMode('friend')}
                  disabled={friends.length === 0 && !loadingFriends}
                >
                  Existing friend
                </button>
                <button
                  type="button"
                  className={`min-h-11 rounded-full transition ${mode === 'new' ? 'bg-foreground text-background' : 'text-muted-foreground'}`}
                  onClick={() => setMode('new')}
                >
                  New friend
                </button>
              </div>
            </div>

            {mode === 'friend' ? (
              <div className="mt-5 rounded-xl border">
                {loadingFriends ? (
                  <p className="text-muted-foreground p-4 text-sm">
                    Loading friends…
                  </p>
                ) : friends.length === 0 ? (
                  <p className="text-muted-foreground p-4 text-sm">
                    No active friends yet. Enter a name and phone instead.
                  </p>
                ) : (
                  friends.map((friend) => (
                    <button
                      key={friend.id}
                      type="button"
                      className="hover:bg-muted/60 block w-full border-b px-4 py-3 text-left last:border-b-0"
                      onClick={() => chooseFriend(friend)}
                    >
                      <span className="font-medium">{friend.displayName}</span>
                      {friend.declaredInterests?.length ? (
                        <span className="text-muted-foreground mt-1 block text-xs">
                          Into {friend.declaredInterests.slice(0, 3).join(', ')}
                        </span>
                      ) : null}
                    </button>
                  ))
                )}
              </div>
            ) : (
              <form className="mt-5 space-y-4" onSubmit={createInvite}>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium">
                    Name
                    <input
                      className="bg-background focus:border-foreground mt-2 h-12 w-full rounded-xl border px-3 text-base outline-none"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                      placeholder="Their name"
                      autoComplete="name"
                    />
                  </label>
                  <label className="block text-sm font-medium">
                    Phone number
                    <input
                      className="bg-background focus:border-foreground mt-2 h-12 w-full rounded-xl border px-3 text-base outline-none"
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                      placeholder="(555) 123-4567"
                      autoComplete="tel"
                      inputMode="tel"
                    />
                  </label>
                </div>

                <div className="bg-card space-y-3 rounded-xl border p-4">
                  <p className="text-sm font-medium">Suggested interests</p>
                  {interests.map((interest, index) => (
                    <label
                      key={index}
                      className="text-muted-foreground block text-xs font-medium tracking-[0.08em] uppercase"
                    >
                      {index === 0
                        ? 'Prefilled from your search'
                        : `Optional interest ${index + 1}`}
                      <input
                        className="bg-background text-foreground focus:border-foreground disabled:bg-muted mt-2 h-11 w-full rounded-lg border px-3 text-sm tracking-normal normal-case outline-none"
                        value={interest}
                        disabled={index === 0}
                        onChange={(event) =>
                          updateInterest(index, event.target.value)
                        }
                        placeholder={
                          index === 1
                            ? 'Another thing they know'
                            : 'One more, if useful'
                        }
                      />
                    </label>
                  ))}
                </div>

                {error ? (
                  <p className="text-destructive text-sm font-medium">
                    {error}
                  </p>
                ) : null}

                <div className="flex items-center gap-3">
                  <button
                    type="submit"
                    className="btn-primary min-h-12 flex-1 rounded-full"
                    disabled={submitting}
                  >
                    {submitting ? 'Creating ask…' : 'Create ask'}
                  </button>
                  <button
                    type="button"
                    className="text-muted-foreground px-3 text-sm"
                    onClick={onClose}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </section>
    </div>
  )
}
