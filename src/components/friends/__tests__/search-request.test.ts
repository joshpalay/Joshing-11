import { describe, expect, it, vi } from 'vitest'
import { createFriendSearchRequest } from '../search-request'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(fetchImpl: typeof fetch) {
  const callbacks = { start: vi.fn(), result: vi.fn(), error: vi.fn(), finish: vi.fn() }
  return { callbacks, request: createFriendSearchRequest(callbacks, fetchImpl) }
}

describe('latest exact friend lookup', () => {
  it('clearing or editing the field invalidates a request before its response arrives', async () => {
    const pending = deferred<Response>()
    const fetcher = vi.fn<typeof fetch>().mockReturnValue(pending.promise)
    const { request, callbacks } = setup(fetcher)
    const running = request.run('@oldquery')
    request.invalidate()
    expect((fetcher.mock.calls[0]![1]!.signal as AbortSignal).aborted).toBe(true)
    pending.resolve(Response.json({ match: { id: 'old-person' } }))
    await running
    expect(callbacks.result).not.toHaveBeenCalled()
    expect(callbacks.error).not.toHaveBeenCalled()
    expect(callbacks.finish).not.toHaveBeenCalled()
  })

  it('does not show an old result that finishes JSON parsing after a newer lookup', async () => {
    const body = deferred<{ match: { id: string } }>()
    const parsing = deferred<boolean>()
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce({ ok: true, json: () => { parsing.resolve(true); return body.promise } } as Response)
      .mockResolvedValueOnce(Response.json({ match: { id: 'new-person' } }))
    const { request, callbacks } = setup(fetcher)
    const old = request.run('@oldquery')
    await parsing.promise
    await request.run('@newquery')
    body.resolve({ match: { id: 'old-person' } })
    await old
    expect(callbacks.result.mock.calls).toEqual([[{ id: 'new-person' }]])
    expect(callbacks.finish).toHaveBeenCalledTimes(1)
  })

  it('does not surface a stale network failure after unmount/reset', async () => {
    const pending = deferred<Response>()
    const { request, callbacks } = setup(vi.fn<typeof fetch>().mockReturnValue(pending.promise))
    const running = request.run('@auditquery')
    request.invalidate()
    pending.reject(new Error('offline'))
    await running
    expect(callbacks.error).not.toHaveBeenCalled()
  })

  it('explains the server rate limit without automatic retries', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 429, headers: { 'Retry-After': '42' },
    }))
    const { request, callbacks } = setup(fetcher)
    await request.run('@auditquery')
    expect(callbacks.error).toHaveBeenCalledWith('Please wait 42 seconds before searching again.')
    expect(callbacks.finish).toHaveBeenCalledOnce()
    expect(fetcher).toHaveBeenCalledOnce()
  })

  it('allows an explicit retry after a network error and preserves no-match', async () => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(Response.json({ match: null }))
    const { request, callbacks } = setup(fetcher)
    await request.run('@auditquery')
    await request.run('@auditquery')
    expect(callbacks.error).toHaveBeenCalledWith('Network error. Press Enter to try again.')
    expect(callbacks.result).toHaveBeenCalledWith(null)
  })
})
