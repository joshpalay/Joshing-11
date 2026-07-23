// Initials chip with deterministic background color. Designed to be dropped
// into friends lists, request rows, and search results so the visual variety
// in the friends surfaces (`[SA]`, `[RO]`) actually renders with distinct
// colors per user.
//
// Color comes from the persisted users.avatar_color when available, falling
// back to colorForUser() so this works for any caller that hasn't (or can't)
// load the column. initialsFor() is the same helper the feed cards use.

import { AVATAR_COLORS, colorForUser, initialsFor, isDarkColor } from '@/components/feed/visual'

type Size = 'sm' | 'md' | 'lg'

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'h-7 w-7 type-eyebrow',
  md: 'h-9 w-9 text-xs',
  lg: 'h-12 w-12 text-sm',
}

function normalizeColor(color: string | null | undefined, userId: string): string {
  if (color && (AVATAR_COLORS as readonly string[]).includes(color)) return color
  return colorForUser(userId)
}

type AvatarChipProps = {
  displayName: string
  userId: string
  color?: string | null
  size?: Size
}

export function AvatarChip({ displayName, userId, color, size = 'md' }: AvatarChipProps) {
  const bg = normalizeColor(color, userId)
  const onDark = isDarkColor(bg)
  return (
    <div
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${SIZE_CLASSES[size]}`}
      style={{
        backgroundColor: bg,
        color: onDark ? 'var(--cream, #fff)' : 'var(--ink, #111)',
      }}
    >
      {initialsFor(displayName)}
    </div>
  )
}
