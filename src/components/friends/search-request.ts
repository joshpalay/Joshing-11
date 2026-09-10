export type SearchCallbacks<T> = {
  start: () => void
  result: (match: T | null) => void
  error: (message: string) => void
  finish: () => void
}

// A query edit invalidates the active lookup immediately, including while its
// body is decoding. Aborting saves work; the version guard also covers fetch
// implementations that finish despite cancellation.
export function createFriendSearchRequest<T>(
  callbacks: SearchCallbacks<T>,
  fetchImpl: typeof fetch = fetch,
) {
  let version = 0
  let controller: AbortController | null = null

  function invalidate() {
    version += 1
    controller?.abort()
    controller = null
  }

  async function run(query: string) {
    invalidate()
    if (!query.trim()) return
    const current = version
    controller = new AbortController()
    callbacks.start()
    try {
      const response = await fetchImpl(`/api/friends/search?q=${encodeURIComponent(query.trim())}`, {
        credentials: 'include',
        signal: controller.signal,
      })
      if (current !== version) return
      if (!response.ok) {
        const seconds = Number(response.headers.get('Retry-After'))
        callbacks.error(response.status === 429
          ? Number.isFinite(seconds) && seconds > 0
            ? `Please wait ${Math.ceil(seconds)} seconds before searching again.`
            : 'Please wait a moment before searching again.'
          : 'Search failed. Press Enter to try again.')
        return
      }
      const body = await response.json() as { match: T | null }
      if (current !== version) return
      callbacks.result(body.match ?? null)
    } catch {
      if (current === version) callbacks.error('Network error. Press Enter to try again.')
    } finally {
      if (current === version) callbacks.finish()
    }
  }

  return { run, invalidate }
}
