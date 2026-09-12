'use client'

import { useEffect, useRef, useState } from 'react'

import { AddFriendButton } from '@/components/friends/AddFriendButton'
import { createFriendSearchRequest } from '@/components/friends/search-request'
import {
  ADD_SOMEONE_FOCUS_EVENT,
  resolveAddSomeoneOutcome,
  type QueryClassification,
} from '@/components/friends/add-someone'
import { colorForUser, formatRelativeTime } from '@/components/feed/visual'
import type { RelationshipResult } from '@/server/db/queries/friend-requests'

// Hands a failed lookup off to the personal-invite flow (#personal-invite),
// prefilling whichever field the typed query actually looks like. A "handle"
// classification isn't a phone or a free-text name, so it's left blank rather
// than guessed into the wrong field.
function sendPersonalInviteHandoff(query: string, classification: QueryClassification) {
  const trimmed = query.trim()
  const detail =
    classification === 'phone'
      ? { phone: trimmed }
      : classification === 'name'
        ? { inviteeDisplayName: trimmed }
        : {}
  window.dispatchEvent(new CustomEvent('friend-invitations:create-new', { detail }))
}

type Match = {
  id: string
  handle: string | null
  displayName: string | null
  avatarColor: string | null
  createdAt: string
  relationship: RelationshipResult
}

const DEBOUNCE_MS = 400

function initialsFor(name: string | null, fallback: string): string {
  const source = (name?.trim() || fallback).replace(/[^a-zA-Z]+/g, ' ').trim()
  if (!source) return '??'
  const parts = source.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

// The Find Friends search on the consolidated /friends page: exact @handle or
// phone lookup. Also accepts a focus hand-off (ADD_SOMEONE_FOCUS_EVENT) from
// FriendsList's empty-filter exit — "no friends match this filter, search
// instead" — which carries no term, so it's a focus request, not a query.
export function FindFriendsSearch() {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [match, setMatch] = useState<Match | null>(null)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<number | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [searchRequest] = useState(() => createFriendSearchRequest<Match>({
    start: () => { setSearching(true); setError(null); setMatch(null) },
    result: (value) => { setMatch(value); setSearched(true) },
    error: (message) => { setError(message); setMatch(null); setSearched(true) },
    finish: () => setSearching(false),
  }))

  useEffect(() => () => searchRequest.invalidate(), [searchRequest])

  // Debounced fetch only — never setState synchronously inside the effect
  // body (linter rule react-hooks/set-state-in-effect). The "clear on
  // empty query" path is handled in handleQueryChange below.
  useEffect(() => {
    if (!query.trim()) return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      debounceRef.current = null
      void searchRequest.run(query)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [query, searchRequest])

  useEffect(() => {
    function onFocusRequest() {
      searchRequest.invalidate()
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
      setSearching(false)
      setQuery('')
      setMatch(null)
      setSearched(false)
      setError(null)
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      inputRef.current?.focus({ preventScroll: true })
    }
    window.addEventListener(ADD_SOMEONE_FOCUS_EVENT, onFocusRequest)
    return () => window.removeEventListener(ADD_SOMEONE_FOCUS_EVENT, onFocusRequest)
  }, [searchRequest])

  function handleQueryChange(value: string) {
    searchRequest.invalidate()
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    setQuery(value)
    setSearching(Boolean(value.trim()))
    setMatch(null)
    setSearched(false)
    setError(null)
  }

  function refreshAfterAction() {
    void searchRequest.run(query)
  }

  const matchDisplayName = match
    ? match.displayName?.trim() || (match.handle ? `@${match.handle}` : 'Joshing player')
    : ''
  const initials = match ? initialsFor(match.displayName, match.handle ?? '?') : ''
  const swatch = match ? match.avatarColor || colorForUser(match.id) : null
  const outcome = resolveAddSomeoneOutcome({
    query,
    searching,
    searched,
    error: error !== null,
    match,
  })

  return (
    <section
      ref={sectionRef}
      className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]"
    >
      <h2 className="font-serif text-lg font-semibold">Find an existing player</h2>
      <p id="friend-search-help" className="text-muted-foreground mt-1 text-sm">
        By exact username or US phone number. Usernames aren’t case-sensitive.
      </p>
      <input
        ref={inputRef}
        type="search"
        aria-label="Find a player by username or US phone number"
        aria-describedby="friend-search-help"
        value={query}
        onChange={(event) => handleQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (debounceRef.current) window.clearTimeout(debounceRef.current)
            debounceRef.current = null
            void searchRequest.run(query)
          }
        }}
        placeholder="@username or US phone number"
        className="border-[var(--accent-gold)] bg-[var(--brand-field)] text-foreground placeholder:text-muted-foreground mt-3 h-11 w-full rounded-md border px-3 text-sm outline-none focus:border-[var(--brand-navy)] focus-visible:ring-2 focus-visible:ring-ring"
      />

      <div className="mt-3 min-h-[44px]" aria-live="polite" aria-busy={searching}>
        {outcome.kind === 'searching' ? (
          <p className="text-muted-foreground text-sm">Searching…</p>
        ) : outcome.kind === 'error' ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : outcome.kind === 'match' && match ? (
          <article className="bg-background flex flex-wrap items-start gap-3 rounded-xl border p-3">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: swatch ?? 'var(--brand-ink-400)' }}
            >
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-foreground font-medium break-words">{matchDisplayName}</h3>
              {match.handle ? (
                <p className="text-muted-foreground text-xs">@{match.handle}</p>
              ) : null}
              <p className="text-muted-foreground/70 mt-1 text-xs">
                joined {formatRelativeTime(match.createdAt)}
              </p>
            </div>
            <AddFriendButton
              targetUserId={match.id}
              targetDisplayName={matchDisplayName}
              relationship={match.relationship}
              onChange={refreshAfterAction}
            />
          </article>
        ) : outcome.kind === 'no_match' ? (
          <p className="text-muted-foreground text-sm">
            No matching player found. Check the full username or phone number,{' '}
            <a
              href="#personal-invite"
              className="underline underline-offset-2"
              onClick={() => sendPersonalInviteHandoff(query, outcome.classification)}
            >
              send them a personal invite
            </a>
            , or{' '}
            <a href="#invite-links" className="underline underline-offset-2">
              share an invite link
            </a>
            .
          </p>
        ) : null}
      </div>
    </section>
  )
}
