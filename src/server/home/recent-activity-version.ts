import { cookies } from 'next/headers'

import { RECENT_ACTIVITY_COOKIE, resolveRecentActivityVersion } from '@/lib/recent-activity-version'

export async function getRecentActivityVersion(userId: string | null, override?: string | string[]) {
  const preference = userId ? (await cookies()).get(RECENT_ACTIVITY_COOKIE)?.value : undefined
  return resolveRecentActivityVersion(userId, preference, override)
}
