export type RecentActivityVersion = 'shared' | 'current'

export const RECENT_ACTIVITY_COOKIE = 'joshing_recent_activity'

export function resolveRecentActivityVersion(
  userId: string | null,
  cookieValue: string | undefined,
  override?: string | string[],
): RecentActivityVersion {
  if (override === 'current' || override === 'shared') return override
  if (!userId || !cookieValue) return 'shared'
  try {
    const value: unknown = JSON.parse(cookieValue)
    if (value && typeof value === 'object' && 'userId' in value && value.userId === userId &&
      'version' in value && (value.version === 'current' || value.version === 'shared')) return value.version
  } catch { /* An expired or malformed preference falls back to the new view. */ }
  return 'shared'
}
