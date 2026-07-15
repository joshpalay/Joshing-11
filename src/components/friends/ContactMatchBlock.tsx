'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { AddFriendButton } from '@/components/friends/AddFriendButton'
import { colorForUser, formatRelativeTime } from '@/components/feed/visual'
import { normalizeToE164 } from '@/lib/phone-e164'
import type { RelationshipResult } from '@/server/db/queries/friend-requests'

type Match = {
  id: string
  handle: string | null
  displayName: string | null
  avatarColor: string | null
  createdAt: string
  relationship: RelationshipResult
}

type MatchesResponse = {
  matches: Match[]
  lastUploadedAt: string | null
  refreshDue: boolean
}

type Props = {
  discoverableByContacts: boolean
  initialMatches: Match[]
  initialRefreshDue: boolean
}

function initialsFor(name: string | null, fallback: string): string {
  const source = (name?.trim() || fallback).replace(/[^a-zA-Z]+/g, ' ').trim()
  if (!source) return '??'
  const parts = source.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

function supportsContactsAPI(): boolean {
  if (typeof navigator === 'undefined') return false
  const contacts = (navigator as Navigator).contacts
  return Boolean(contacts && typeof contacts.select === 'function')
}

async function hashPhoneClient(salt: string, e164: string): Promise<string> {
  const data = new TextEncoder().encode(salt + e164)
  const buf = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

export function ContactMatchBlock({
  discoverableByContacts,
  initialMatches,
  initialRefreshDue,
}: Props) {
  const [matches, setMatches] = useState<Match[]>(initialMatches)
  const [refreshDue, setRefreshDue] = useState(initialRefreshDue)
  const [matching, setMatching] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 1800)
    return () => window.clearTimeout(timer)
  }, [toast])

  if (!supportsContactsAPI()) {
    return (
      <section className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
        <h2 className="font-serif text-lg font-semibold">
          Find friends already on Joshing
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Your browser doesn&rsquo;t support automatic contact matching. You can still
          search by @handle or phone number (above), or send a friend an invite link.
        </p>
      </section>
    )
  }

  if (!discoverableByContacts) {
    return (
      <section className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
        <h2 className="font-serif text-lg font-semibold">
          Find friends already on Joshing
        </h2>
        <p className="text-muted-foreground mt-1 text-sm leading-6">
          Turn on contact matching to see which of your contacts are here. We hash
          your contacts on your device and never share them.
        </p>
        <Link
          href="/users/me#privacy-discovery"
          className="btn-primary mt-3 inline-flex items-center px-4"
        >
          Open privacy settings
        </Link>
      </section>
    )
  }

  async function matchContacts() {
    if (matching) return
    setMatching(true)
    setError(null)
    try {
      const navContacts = (navigator as Navigator).contacts
      if (!navContacts) throw new Error('Contacts API unavailable.')

      const contacts = await navContacts.select(['tel'], { multiple: true })
      const phones = new Set<string>()
      for (const contact of contacts) {
        for (const tel of contact.tel ?? []) {
          const e164 = normalizeToE164(tel)
          if (e164) phones.add(e164)
        }
      }

      if (phones.size === 0) {
        setError('No valid US phone numbers found in your contacts.')
        return
      }

      const saltResponse = await fetch('/api/account/phone-hash-salt', {
        credentials: 'include',
      })
      if (!saltResponse.ok) {
        setError('Contact matching is temporarily unavailable. Try again later.')
        return
      }
      const { salt } = (await saltResponse.json()) as { salt: string }

      const hashes = await Promise.all(
        Array.from(phones).map((e164) => hashPhoneClient(salt, e164)),
      )

      const uploadResponse = await fetch('/api/contact-hashes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ hashes }),
      })
      if (!uploadResponse.ok) {
        const body = (await uploadResponse.json().catch(() => null)) as { message?: string } | null
        setError(body?.message ?? 'Could not upload your contacts.')
        return
      }

      const matchesResponse = await fetch('/api/contact-hashes/matches', {
        credentials: 'include',
      })
      if (!matchesResponse.ok) {
        setError('Matches couldn’t load. Try again.')
        return
      }
      const matchBody = (await matchesResponse.json()) as MatchesResponse
      setMatches(matchBody.matches)
      setRefreshDue(matchBody.refreshDue)
      setToast(
        matchBody.matches.length === 0
          ? 'No one yet — check back as more friends join.'
          : `Matched ${matchBody.matches.length} ${matchBody.matches.length === 1 ? 'person' : 'people'}.`,
      )
    } catch (err) {
      // navigator.contacts.select throws on user-cancel; treat as no-op.
      if (err instanceof DOMException && err.name === 'AbortError') return
      setError('Contact matching failed. Try again.')
    } finally {
      setMatching(false)
    }
  }

  return (
    <section className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-serif text-lg font-semibold">
          {matches.length > 0 ? 'Contacts on Joshing' : 'Find friends already on Joshing'}
        </h2>
        {matches.length > 0 ? (
          <button
            type="button"
            onClick={() => void matchContacts()}
            disabled={matching}
            className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4"
          >
            {matching ? 'Refreshing…' : 'Refresh ↻'}
          </button>
        ) : null}
      </div>

      {matches.length === 0 ? (
        <>
          <p className="text-muted-foreground mt-1 text-sm leading-6">
            We can check which of your phone contacts are here. We hash your contacts
            on your device and never share them.
          </p>
          <button
            type="button"
            onClick={() => void matchContacts()}
            disabled={matching}
            className="btn-primary mt-3 inline-flex items-center px-4"
          >
            {matching ? 'Matching…' : 'Match my contacts'}
          </button>
        </>
      ) : (
        <>
          {refreshDue ? (
            <p className="text-muted-foreground/80 mt-1 text-xs">
              Last refreshed over a week ago. Tap Refresh to pick up new joiners.
            </p>
          ) : null}
          <div className="mt-3 space-y-3">
            {matches.map((match) => {
              const displayName = match.displayName?.trim() || `@${match.handle ?? ''}`
              const initials = initialsFor(match.displayName, match.handle ?? '?')
              const swatch = match.avatarColor || colorForUser(match.id)
              return (
                <article
                  key={match.id}
                  className="bg-background flex items-start gap-3 rounded-xl border p-3"
                >
                  <span
                    aria-hidden
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{ background: swatch }}
                  >
                    {initials}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h3 className="text-foreground font-medium">{displayName}</h3>
                    {match.handle ? (
                      <p className="text-muted-foreground text-xs">@{match.handle}</p>
                    ) : null}
                    <p className="text-muted-foreground/70 mt-1 text-xs">
                      joined {formatRelativeTime(match.createdAt)}
                    </p>
                  </div>
                  <AddFriendButton
                    targetUserId={match.id}
                    targetDisplayName={displayName}
                    relationship={match.relationship}
                  />
                </article>
              )
            })}
          </div>
        </>
      )}

      {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
      {toast ? (
        <div className="fixed bottom-24 left-1/2 z-[var(--z-toast)] -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm text-background shadow-lg">
          {toast}
        </div>
      ) : null}
    </section>
  )
}
