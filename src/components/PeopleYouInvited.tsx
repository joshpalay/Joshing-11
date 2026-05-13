'use client'

import { useCallback, useEffect, useState } from 'react'

type InviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled'

type OutgoingInvite = {
  id: string
  inviteeDisplayName: string
  inviteePhoneMasked: string
  inviteePhoneForActions: string | null
  suggestedInterests: string[]
  status: InviteStatus
  sentAt: string
  acceptedAt: string | null
  cancelledAt: string | null
  expiresAt: string
  message: string | null
}

type InvitationsResponse = {
  ok: boolean
  invitations: OutgoingInvite[]
}

const STATUS_COPY: Record<InviteStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  cancelled: 'Cancelled',
}

function buildSmsHref(phone: string, message: string) {
  return `sms:${encodeURIComponent(phone)}?body=${encodeURIComponent(message)}`
}

function friendlyDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : 'numeric',
  }).format(date)
}

function statusDetail(invite: OutgoingInvite) {
  if (invite.status === 'pending') {
    const expires = friendlyDate(invite.expiresAt)
    return expires ? `Expires ${expires}` : 'Invite is ready to send again.'
  }

  if (invite.status === 'accepted') {
    const accepted = invite.acceptedAt ? friendlyDate(invite.acceptedAt) : null
    return accepted ? `Accepted ${accepted}` : 'They joined Joshing.'
  }

  if (invite.status === 'expired') {
    const expired = friendlyDate(invite.expiresAt)
    return expired ? `Expired ${expired}` : 'This invite link expired.'
  }

  const cancelled = invite.cancelledAt ? friendlyDate(invite.cancelledAt) : null
  return cancelled ? `Cancelled ${cancelled}` : 'This invite was cancelled.'
}

export default function PeopleYouInvited() {
  const [invites, setInvites] = useState<OutgoingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const loadInvites = useCallback(async () => {
    setError(null)

    try {
      const response = await fetch('/api/friend-invitations', {
        cache: 'no-store',
        credentials: 'include',
      })
      const body = (await response.json().catch(() => null)) as
        | InvitationsResponse
        | { message?: string }
        | null

      if (!response.ok || !body || !('invitations' in body)) {
        throw new Error(
          body && 'message' in body && body.message
            ? body.message
            : 'Could not load invitations.'
        )
      }

      setInvites(body.invitations)
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not load invitations.'
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    queueMicrotask(() => void loadInvites())

    function refresh() {
      void loadInvites()
    }

    window.addEventListener('friend-invitations:refresh', refresh)
    return () =>
      window.removeEventListener('friend-invitations:refresh', refresh)
  }, [loadInvites])

  async function copyInvite(invite: OutgoingInvite) {
    if (!invite.message) return

    try {
      await navigator.clipboard.writeText(invite.message)
      setCopyingId(invite.id)
      window.setTimeout(() => setCopyingId(null), 2000)
    } catch {
      if (navigator.share) await navigator.share({ text: invite.message })
    }
  }

  async function cancelInvite(invite: OutgoingInvite) {
    setCancellingId(invite.id)
    setError(null)

    try {
      const response = await fetch('/api/friend-invitations', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invitationId: invite.id }),
      })
      const body = (await response.json().catch(() => null)) as {
        message?: string
      } | null

      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not cancel invite.')
      }

      await loadInvites()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not cancel invite.'
      )
    } finally {
      setCancellingId(null)
    }
  }

  function createNewInvite(invite: OutgoingInvite) {
    window.dispatchEvent(
      new CustomEvent('friend-invitations:create-new', {
        detail: {
          inviteeDisplayName: invite.inviteeDisplayName,
          phone: invite.inviteePhoneForActions ?? '',
          suggestedInterests: invite.suggestedInterests,
        },
      })
    )
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) {
    return (
      <section className="bg-card text-card-foreground mb-5 rounded-2xl border p-4 shadow-sm">
        <h2 className="font-serif text-xl font-semibold">People you invited</h2>
        <p className="text-muted-foreground mt-2 text-sm">Loading invites…</p>
      </section>
    )
  }

  if (!loading && invites.length === 0 && !error) return null

  return (
    <section className="bg-card text-card-foreground mb-5 rounded-2xl border p-4 shadow-sm">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
            Invitations
          </p>
          <h2 className="mt-1 font-serif text-xl font-semibold">
            People you invited
          </h2>
        </div>
        <button
          type="button"
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
          onClick={() => void loadInvites()}
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="text-destructive mb-3 text-sm font-medium">{error}</p>
      ) : null}

      <div className="space-y-3">
        {invites.map((invite) => {
          const canMessage =
            invite.status === 'pending' &&
            invite.message &&
            invite.inviteePhoneForActions

          return (
            <article
              key={invite.id}
              className="bg-background rounded-xl border p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-foreground font-medium">
                    {invite.inviteeDisplayName}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {invite.inviteePhoneMasked}
                  </p>
                </div>
                <span className="bg-muted text-foreground rounded-full px-3 py-1 text-xs font-medium">
                  {STATUS_COPY[invite.status]}
                </span>
              </div>

              {invite.suggestedInterests.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {invite.suggestedInterests.map((interest) => (
                    <span
                      key={interest}
                      className="bg-muted text-foreground rounded-full px-3 py-1 text-sm"
                    >
                      {interest}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="bg-muted text-muted-foreground mt-3 rounded-lg px-3 py-2 text-sm">
                  No suggested interests on this invite.
                </p>
              )}

              <p className="text-muted-foreground mt-3 text-sm">
                {statusDetail(invite)}
              </p>

              {invite.status === 'accepted' ? (
                <p className="bg-muted text-muted-foreground mt-3 rounded-lg px-3 py-2 text-sm">
                  They accepted your invitation and can now become part of your
                  friend circle.
                </p>
              ) : null}

              {invite.status === 'expired' ? (
                <div className="mt-3">
                  <button
                    type="button"
                    className="btn-ghost min-h-11 w-full rounded-full"
                    onClick={() => createNewInvite(invite)}
                  >
                    Create new invite
                  </button>
                </div>
              ) : null}

              {canMessage ? (
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    className="btn-primary min-h-11 rounded-full sm:col-span-1"
                    onClick={() => copyInvite(invite)}
                  >
                    {copyingId === invite.id ? 'Copied ✓' : 'Copy message'}
                  </button>
                  <a
                    className="btn-ghost min-h-11 rounded-full sm:col-span-1"
                    href={buildSmsHref(
                      invite.inviteePhoneForActions!,
                      invite.message!
                    )}
                  >
                    Open Messages
                  </a>
                  <button
                    type="button"
                    className="text-muted-foreground min-h-11 rounded-full border px-4 text-sm font-medium"
                    onClick={() => cancelInvite(invite)}
                    disabled={cancellingId === invite.id}
                  >
                    {cancellingId === invite.id
                      ? 'Cancelling…'
                      : 'Cancel invite'}
                  </button>
                </div>
              ) : null}
            </article>
          )
        })}
      </div>
    </section>
  )
}
