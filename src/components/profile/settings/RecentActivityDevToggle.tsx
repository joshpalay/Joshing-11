'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

import { SettingsGroup } from '@/components/profile/SettingsRow'
import { Switch } from '@/components/ui/Switch'
import type { RecentActivityVersion } from '@/lib/recent-activity-version'

export function RecentActivityDevToggle() {
  const router = useRouter()
  const [version, setVersion] = useState<RecentActivityVersion>('shared')
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      try {
        const response = await fetch('/api/dev/recent-activity', { cache: 'no-store', credentials: 'include' })
        const body = await response.json()
        if (!response.ok || (body.version !== 'shared' && body.version !== 'current')) throw Error()
        if (active) { setVersion(body.version); setReady(true) }
      } catch {
        if (active) setError('Could not load the activity setting. Refresh to try again.')
      }
    })()
    return () => { active = false }
  }, [])

  async function save(useNew: boolean) {
    if (!ready || saving) return
    const previous = version
    const next = useNew ? 'shared' : 'current'
    setVersion(next)
    setSaving(true)
    setError(null)
    try {
      const response = await fetch('/api/dev/recent-activity', {
        method: 'PATCH', credentials: 'include', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ version: next }),
      })
      if (!response.ok) throw Error()
      // Clear the cached Home so the next normal visit uses the saved choice.
      router.refresh()
    } catch {
      setVersion(previous)
      setError('Could not save the activity setting. Please try again.')
    } finally { setSaving(false) }
  }

  return (
    <div>
      <SettingsGroup>
        <div className="flex items-center justify-between gap-4 p-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Use new Recent Activity</p>
            <p id="recent-activity-version-help" className="mt-1 text-xs text-muted-foreground">
              Turn off to use the original activity list. Saved for your account in this browser.
            </p>
          </div>
          <Switch checked={version === 'shared'} onCheckedChange={(checked) => void save(checked)}
            label="Use new Recent Activity" aria-describedby="recent-activity-version-help" disabled={!ready || saving} />
        </div>
      </SettingsGroup>
      {error ? <p className="mt-2 text-xs text-destructive" role="alert">{error}</p> : (
        <p className="mt-2 text-xs text-muted-foreground" role="status" aria-live="polite">
          {saving ? 'Saving…' : ready ? version === 'shared' ? 'Using the new version.' : 'Using the original version.' : 'Loading setting…'}
        </p>
      )}
      <Link href="/" prefetch={false} className="mt-1 inline-flex min-h-11 items-center text-sm text-[var(--brand-link)] underline underline-offset-4">View Home</Link>
    </div>
  )
}
