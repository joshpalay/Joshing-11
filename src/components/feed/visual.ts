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

function hashString(str: string): number {
  return Array.from(str).reduce((sum, char) => sum + char.charCodeAt(0), 0)
}

export function colorForCategory(category?: string | null): string {
  if (!category) return '#9ca3af'
  return CATEGORY_COLORS[
    hashString(category.toLowerCase()) % CATEGORY_COLORS.length
  ]!
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
