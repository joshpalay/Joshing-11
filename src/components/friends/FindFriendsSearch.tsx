'use client'

import { useEffect, useRef, useState } from 'react'

import { AddFriendButton } from '@/components/friends/AddFriendButton'
import {
  ADD_SOMEONE_FOCUS_EVENT,
  resolveAddSomeoneOutcome,
  type QueryClassification,
} from '@/components/friends/add-someone'
import { colorForUser, formatRelativeTime } from '@/components/feed/visual'
import type { RelationshipResult } from '@/server/db/queries/friend-requests'

type Match = {
  id: string
  handle: string | null
  displayName: string | null
  avatarColor: string | null
  createdAt: string
  relationship: RelationshipResult
}

type SearchResponse = { match: Match | null }

// The 'add' variant listens for ADD_SOMEONE_FOCUS_EVENT (defined in
// ./add-someone) — a focus-only hand-off from the FriendsList empty-filter exit
// that carries no search term.

type Props = {
  // 'find' (default): the standalone /friends/find card — header "Search", and a
  // plain "invite them below" hint on no-match.
  // 'add': the Friends-hub block — warm framing, an inline Invite CTA on
  //   no-match, and it listens for ADD_SOMEONE_FOCUS_EVENT to take focus (the
  //   FriendsList empty-filter exit, which carries no term).
  variant?: 'find' | 'add'
  // Only used by the 'add' variant: invoked when the user chooses to invite a
  // no-match. The classification lets the parent prefill the invite flow
  // (phone → SMS invite; handle/name → blank/name).
  onInvite?: (query: string, classification: QueryClassification) => void
}

const DEBOUNCE_MS = 400

function initialsFor(name: string | null, fallback: string): string {
  const source = (name?.trim() || fallback).replace(/[^a-zA-Z]+/g, ' ').trim()
  if (!source) return '??'
  const parts = source.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function FindFriendsSearch({ variant = 'find', onInvite }: Props = {}) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [match, setMatch] = useState<Match | null>(null)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const debounceRef = useRef<number | null>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function runSearch(value: string) {
    const trimmed = value.trim()
    if (!trimmed) {
      setMatch(null)
      setSearched(false)
      setError(null)
      return
    }
    const seq = ++requestSeq.current
    setSearching(true)
    setError(null)
    try {
      const response = await fetch(
        `/api/friends/search?q=${encodeURIComponent(trimmed)}`,
        { credentials: 'include' },
      )
      if (seq !== requestSeq.current) return
      if (!response.ok) {
        setError('Search failed. Try again.')
        setMatch(null)
        setSearched(true)
        return
      }
      const body = (await response.json().catch(() => null)) as SearchResponse | null
      setMatch(body?.match ?? null)
      setSearched(true)
    } catch {
      if (seq !== requestSeq.current) return
      setError('Network error. Try again.')
      setMatch(null)
      setSearched(true)
    } finally {
      if (seq === requestSeq.current) setSearching(false)
    }
  }

  // Debounced fetch only — never setState synchronously inside the effect
  // body (linter rule react-hooks/set-state-in-effect). The "clear on
  // empty query" path is handled in handleQueryChange below.
  useEffect(() => {
    if (!query.trim()) return
    if (debounceRef.current) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => {
      void runSearch(query)
    }, DEBOUNCE_MS)
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current)
    }
  }, [query])

  // The 'add' variant accepts a focus hand-off from elsewhere on the page (the
  // FriendsList empty-filter exit). It brings the user to a blank lookup and
  // focuses the input — deliberately carrying NO term, so they're prompted for a
  // call sign or number instead of being handed a dead name fragment.
  useEffect(() => {
    if (variant !== 'add') return
    function onFocusRequest() {
      setQuery('')
      setMatch(null)
      setSearched(false)
      setError(null)
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      inputRef.current?.focus({ preventScroll: true })
    }
    window.addEventListener(ADD_SOMEONE_FOCUS_EVENT, onFocusRequest)
    return () => window.removeEventListener(ADD_SOMEONE_FOCUS_EVENT, onFocusRequest)
  }, [variant])

  function handleQueryChange(value: string) {
    setQuery(value)
    if (!value.trim()) {
      setMatch(null)
      setSearched(false)
      setError(null)
    }
  }

  function refreshAfterAction() {
    void runSearch(query)
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

  // The 'add' variant lives inside the hub's card, so it drops the card chrome
  // and brings its own warm framing; the standalone 'find' page keeps the card.
  const isAdd = variant === 'add'

  return (
    <section
      ref={sectionRef}
      className={
        isAdd
          ? ''
          : 'bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]'
      }
    >
      {isAdd ? (
        <>
          <p className="text-muted-foreground text-xs font-medium tracking-[0.14em] uppercase">
            Add someone
          </p>
          <h2 className="text-foreground mt-3 font-serif text-2xl leading-tight font-semibold">
            Add a friend
          </h2>
          <p className="text-muted-foreground mt-2 text-sm leading-6">
            Search by @handle or US number — exact matches only. Not on Joshing
            yet? You can invite them.
          </p>
        </>
      ) : (
        <>
          <h2 className="font-serif text-lg font-semibold">Search</h2>
          <p className="text-muted-foreground mt-1 text-sm">
            By @handle or US phone number. Exact matches only.
          </p>
        </>
      )}
      <input
        ref={inputRef}
        type="search"
        value={query}
        onChange={(event) => handleQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            void runSearch(query)
          }
        }}
        placeholder="@handle or (415) 555-1234"
        className="border-[var(--accent-gold)] bg-[var(--brand-field)] text-foreground placeholder:text-muted-foreground mt-3 h-11 w-full rounded-md border px-3 text-sm outline-none focus:border-[var(--brand-navy)]"
      />

      <div className="mt-3 min-h-[44px]">
        {outcome.kind === 'searching' ? (
          <p className="text-muted-foreground text-sm">Searching…</p>
        ) : outcome.kind === 'error' ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : outcome.kind === 'match' && match ? (
          <article className="bg-background flex items-start gap-3 rounded-xl border p-3">
            <span
              aria-hidden
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
              style={{ background: swatch ?? '#888' }}
            >
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-foreground font-medium">{matchDisplayName}</h3>
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
          isAdd ? (
            <div className="bg-background rounded-xl border p-3">
              <p className="text-muted-foreground text-sm">
                No one by that call sign or number yet — they may not be on Joshing.
              </p>
              <button
                type="button"
                className="btn-ghost mt-2"
                onClick={() => onInvite?.(query.trim(), outcome.classification)}
              >
                Invite them
              </button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              No one by that name. They may not be on Joshing yet — you can invite them below.
            </p>
          )
        ) : null}
      </div>
    </section>
  )
}
