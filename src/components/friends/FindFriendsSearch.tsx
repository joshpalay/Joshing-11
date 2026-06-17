'use client'

import { useEffect, useRef, useState } from 'react'

import { AddFriendButton } from '@/components/friends/AddFriendButton'
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

const DEBOUNCE_MS = 400

function initialsFor(name: string | null, fallback: string): string {
  const source = (name?.trim() || fallback).replace(/[^a-zA-Z]+/g, ' ').trim()
  if (!source) return '??'
  const parts = source.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function FindFriendsSearch() {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [match, setMatch] = useState<Match | null>(null)
  const [searched, setSearched] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const debounceRef = useRef<number | null>(null)

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

  const matchDisplayName = match ? match.displayName?.trim() || `@${match.handle ?? ''}` : ''
  const initials = match ? initialsFor(match.displayName, match.handle ?? '?') : ''
  const swatch = match ? match.avatarColor || colorForUser(match.id) : null

  return (
    <section className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-4 shadow-[var(--shadow-card)]">
      <h2 className="font-serif text-lg font-semibold">Search</h2>
      <p className="text-muted-foreground mt-1 text-sm">
        By @handle or US phone number. Exact matches only.
      </p>
      <input
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
        {searching ? (
          <p className="text-muted-foreground text-sm">Searching…</p>
        ) : error ? (
          <p className="text-destructive text-sm">{error}</p>
        ) : match ? (
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
        ) : searched ? (
          <p className="text-muted-foreground text-sm">
            No one by that name. They may not be on Joshing yet — you can invite them below.
          </p>
        ) : null}
      </div>
    </section>
  )
}
