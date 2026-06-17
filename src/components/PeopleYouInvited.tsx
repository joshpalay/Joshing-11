'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'

import { Chip } from '@/components/ui/Chip'

type InviteStatus = 'pending' | 'accepted' | 'expired' | 'cancelled'

type OutgoingInvite = {
  id: string
  inviteeDisplayName: string
  inviteeUserId: string | null
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
  pending: 'Ready to share',
  accepted: 'Accepted',
  expired: 'Needs fresh note',
  cancelled: 'Set aside',
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
    return expires
      ? `Link rests after ${expires}`
      : 'Your note is ready to share.'
  }

  if (invite.status === 'accepted') {
    const accepted = invite.acceptedAt ? friendlyDate(invite.acceptedAt) : null
    return accepted ? `Accepted ${accepted}` : 'They joined Joshing.'
  }

  if (invite.status === 'expired') {
    const expired = friendlyDate(invite.expiresAt)
    return expired ? `Link rested ${expired}` : 'This link needs a fresh note.'
  }

  const cancelled = invite.cancelledAt ? friendlyDate(invite.cancelledAt) : null
  return cancelled ? `Set aside ${cancelled}` : 'This note was set aside.'
}

export default function PeopleYouInvited() {
  const [invites, setInvites] = useState<OutgoingInvite[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copyingId, setCopyingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

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
        throw new Error(body?.message ?? 'Could not set this aside.')
      }

      await loadInvites()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not set this aside.'
      )
    } finally {
      setCancellingId(null)
    }
  }

  async function deleteInvite(invite: OutgoingInvite) {
    setDeletingId(invite.id)
    setError(null)

    try {
      const response = await fetch('/api/friend-invitations', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ invitationId: invite.id, permanent: true }),
      })
      const body = (await response.json().catch(() => null)) as {
        message?: string
      } | null

      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not delete this.')
      }

      await loadInvites()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not delete this.'
      )
    } finally {
      setDeletingId(null)
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

  return (
    <section className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
      {error ? (
        <p className="text-destructive mb-3 text-sm font-medium">{error}</p>
      ) : null}

      {loading ? (
        <p className="text-muted-foreground text-sm">Loading invites…</p>
      ) : invites.length === 0 ? (
        <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
          No notes sent yet.
        </p>
      ) : (
        <div className="space-y-3">
          {invites.map((invite) => {
            const canMessage =
              invite.status === 'pending' &&
              invite.message &&
              invite.inviteePhoneForActions
            const acceptedProfileHref =
              invite.status === 'accepted' && invite.inviteeUserId
                ? `/users/${invite.inviteeUserId}`
                : null

            const header = (
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-foreground font-medium">
                    {invite.inviteeDisplayName}
                  </h3>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {invite.inviteePhoneMasked}
                  </p>
                </div>
                <Chip className="px-3">{STATUS_COPY[invite.status]}</Chip>
              </div>
            )

            return (
              <article
                key={invite.id}
                className="bg-background rounded-xl border p-3"
              >
                {acceptedProfileHref ? (
                  <Link
                    href={acceptedProfileHref}
                    className="hover:border-foreground/30 -m-3 mb-0 block rounded-xl p-3 transition hover:shadow-sm"
                  >
                    {header}
                  </Link>
                ) : (
                  header
                )}

                {invite.suggestedInterests.length > 0 ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {invite.suggestedInterests.map((interest) => (
                      <Chip
                        key={interest}
                        className="bg-primary/5 border border-primary/10 px-3 text-sm"
                      >
                        {interest}
                      </Chip>
                    ))}
                  </div>
                ) : (
                  <p className="bg-muted text-muted-foreground mt-3 rounded-lg px-3 py-2 text-sm">
                    No ideas attached to this note.
                  </p>
                )}

                <p className="text-muted-foreground mt-3 text-sm">
                  {statusDetail(invite)}
                </p>

                {invite.status === 'accepted' ? (
                  <p className="bg-muted text-muted-foreground mt-3 rounded-lg px-3 py-2 text-sm">
                    They accepted your note — now you can trade questions more
                    easily.
                  </p>
                ) : null}

                {invite.status === 'expired' ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="btn-ghost w-full"
                      onClick={() => createNewInvite(invite)}
                    >
                      Write a fresh note
                    </button>
                  </div>
                ) : null}

                {invite.status === 'cancelled' ? (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      className="text-muted-foreground text-sm"
                      onClick={() => deleteInvite(invite)}
                      disabled={deletingId === invite.id}
                    >
                      {deletingId === invite.id ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                ) : null}

                {canMessage ? (
                  <div className="mt-3 space-y-2">
                    <a
                      className="btn-primary flex w-full items-center justify-center"
                      href={buildSmsHref(
                        invite.inviteePhoneForActions!,
                        invite.message!
                      )}
                    >
                      Send message
                    </a>
                    <div className="flex justify-center gap-6">
                      <button
                        type="button"
                        className="text-muted-foreground text-sm"
                        onClick={() => copyInvite(invite)}
                      >
                        {copyingId === invite.id ? 'Copied ✓' : 'Copy instead'}
                      </button>
                      <button
                        type="button"
                        className="text-muted-foreground text-sm"
                        onClick={() => cancelInvite(invite)}
                        disabled={cancellingId === invite.id}
                      >
                        {cancellingId === invite.id
                          ? 'Setting aside…'
                          : 'Set aside'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </article>
            )
          })}
        </div>
      )}
    </section>
  )
}
