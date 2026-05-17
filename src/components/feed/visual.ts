const CATEGORY_COLORS = [
  '#0f766e',
  '#7c3aed',
  '#be123c',
  '#2563eb',
  '#b45309',
  '#15803d',
  '#c2410c',
  '#0369a1',
] as const

const AVATAR_COLORS = [
  '#0f766e',
  '#7c3aed',
  '#be123c',
  '#2563eb',
  '#b45309',
  '#15803d',
] as const

function hashString(str: string): number {
  return Array.from(str).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

export function colorForCategory(category?: string | null): string {
  if (!category) return '#9ca3af'
  return CATEGORY_COLORS[
    hashString(category.toLowerCase()) % CATEGORY_COLORS.length
  ]!
}

export function colorForUser(userId?: string | null): string {
  if (!userId) return '#9ca3af'
  return AVATAR_COLORS[hashString(userId) % AVATAR_COLORS.length]!
}

export function isDarkColor(hex: string): boolean {
  const clean = hex.replace('#', '')
  if (clean.length !== 6) return true
  const r = parseInt(clean.slice(0, 2), 16) / 255
  const g = parseInt(clean.slice(2, 4), 16) / 255
  const b = parseInt(clean.slice(4, 6), 16) / 255
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.55
}

export function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0] ?? ''}${parts[parts.length - 1]![0] ?? ''}`.toUpperCase()
}

export function formatRelativeTime(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  const diffSeconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSeconds < 45) return 'just now'
  const minutes = Math.floor(diffSeconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

const RECENCY_BUCKETS = [
  { key: 'past-few-hours', label: 'Past few hours', maxMs: 5 * HOUR_MS },
  { key: 'today', label: 'Today', maxMs: 24 * HOUR_MS },
  { key: 'past-few-days', label: 'Past few days', maxMs: 3 * DAY_MS },
  { key: 'this-week', label: 'This week', maxMs: 7 * DAY_MS },
  { key: 'past-two-weeks', label: 'Past two weeks', maxMs: 14 * DAY_MS },
  { key: 'past-few-weeks', label: 'Past few weeks', maxMs: 28 * DAY_MS },
  { key: 'older', label: 'Older', maxMs: Infinity },
] as const

const MIN_GROUP_SIZE = 5

export type RecencyGroup<T> = {
  key: string
  label: string
  items: T[]
}

type WithSourceEventAt = { source_event_at: string }

export function groupItemsByRecency<T extends WithSourceEventAt>(
  items: readonly T[],
  now: number = Date.now(),
): RecencyGroup<T>[] {
  if (items.length === 0) return []

  const ages = items.map((item) => {
    const parsed = Date.parse(item.source_event_at)
    return Number.isNaN(parsed) ? Infinity : now - parsed
  })

  const groups: RecencyGroup<T>[] = []
  let cursor = 0
  let startBucket = 0

  while (cursor < items.length) {
    const remaining = items.length - cursor
    let chosen = -1

    for (let b = startBucket; b < RECENCY_BUCKETS.length; b++) {
      const maxMs = RECENCY_BUCKETS[b]!.maxMs
      let count = 0
      for (let i = cursor; i < items.length; i++) {
        if (ages[i]! <= maxMs) count++
        else break
      }
      if (count >= MIN_GROUP_SIZE) {
        chosen = b
        break
      }
    }

    if (chosen === -1) {
      let smallestFit = RECENCY_BUCKETS.length - 1
      for (let b = startBucket; b < RECENCY_BUCKETS.length; b++) {
        if (ages[items.length - 1]! <= RECENCY_BUCKETS[b]!.maxMs) {
          smallestFit = b
          break
        }
      }
      const bucket = RECENCY_BUCKETS[smallestFit]!
      groups.push({
        key: bucket.key,
        label: bucket.label,
        items: items.slice(cursor),
      })
      cursor += remaining
      break
    }

    const bucket = RECENCY_BUCKETS[chosen]!
    let count = 0
    for (let i = cursor; i < items.length; i++) {
      if (ages[i]! <= bucket.maxMs) count++
      else break
    }
    groups.push({
      key: bucket.key,
      label: bucket.label,
      items: items.slice(cursor, cursor + count),
    })
    cursor += count
    startBucket = chosen + 1
  }

  return groups
}
