'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { colorForUser } from '@/components/feed/visual'

export type BlockedListItem = {
  id: string
  handle: string | null
  displayName: string | null
  avatarColor: string | null
}

function initialsFor(name: string | null, fallback: string): string {
  const source = (name?.trim() || fallback).replace(/[^a-zA-Z]+/g, ' ').trim()
  if (!source) return '??'
  const parts = source.split(/\s+/)
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function BlockedList({ initialItems }: { initialItems: BlockedListItem[] }) {
  const router = useRouter()
  const [items, setItems] = useState(initialItems)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUnblock(id: string) {
    if (pendingId) return
    setPendingId(id)
    setError(null)
    try {
      const response = await fetch(`/api/users/${encodeURIComponent(id)}/block`, {
        method: 'DELETE',
        credentials: 'include',
      })
      if (!response.ok) {
        setError('Could not unblock this person. Try again.')
        return
      }
      setItems((prev) => prev.filter((item) => item.id !== id))
      router.refresh()
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setPendingId(null)
    }
  }

  if (items.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">You haven&apos;t blocked anyone.</p>
    )
  }

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const displayName = item.displayName?.trim() || `@${item.handle ?? ''}`
        const initials = initialsFor(item.displayName, item.handle ?? '?')
        const swatch = item.avatarColor || colorForUser(item.id)
        return (
          <div
            key={item.id}
            className="bg-card text-card-foreground flex items-center gap-3 rounded-xl border p-3"
          >
            <span
              aria-hidden
              className="text-primary-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold"
              style={{ background: swatch }}
            >
              {initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-foreground font-medium">{displayName}</p>
              {item.handle ? <p className="text-muted-foreground text-xs">@{item.handle}</p> : null}
            </div>
            <button
              type="button"
              onClick={() => void handleUnblock(item.id)}
              disabled={pendingId === item.id}
              className="text-muted-foreground text-sm underline-offset-4 hover:underline"
            >
              {pendingId === item.id ? 'Unblocking…' : 'Unblock'}
            </button>
          </div>
        )
      })}
      {error ? <p className="text-destructive text-sm">{error}</p> : null}
    </div>
  )
}
