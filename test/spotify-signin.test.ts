import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'record-crate:spotify'
const TOKEN_URL = 'https://accounts.spotify.com/api/token'

/** A fresh copy of the module, imported signed out so it doesn't start the player. */
async function freshSpotify(refresh: () => Promise<Response>) {
  vi.resetModules()
  const fetch = vi.fn((url: string) => (url === TOKEN_URL ? refresh() : Promise.reject(new Error(`unexpected ${url}`))))
  vi.stubGlobal('fetch', fetch)
  const spotify = await import('../app/spotify')
  localStorage.setItem(KEY, JSON.stringify({ access: 'old-access', refresh: 'old-refresh', until: Date.now() - 1000 }))
  return { fetch, ...spotify }
}

const refreshed = () =>
  Promise.resolve(
    new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh', expires_in: 3600 }), {
      status: 200,
    }),
  )
const saved = () => JSON.parse(localStorage.getItem(KEY) || 'null')

beforeEach(() => localStorage.clear())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the Spotify token', () => {
  it('refreshes an expired token once, however many ask for it at the same time', async () => {
    const { fetch, token } = await freshSpotify(refreshed)
    expect(await Promise.all([token(), token(), token()])).toEqual(['new-access', 'new-access', 'new-access'])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(saved()).toMatchObject({ access: 'new-access', refresh: 'new-refresh' })
  })

  it('asks again after a refresh fails, rather than sharing the failure', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    let calls = 0
    const { fetch, token } = await freshSpotify(() =>
      calls++ ? refreshed() : Promise.reject(new TypeError('Failed to fetch')),
    )
    await expect(Promise.all([token(), token()])).rejects.toThrow('Failed to fetch')
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(await token()).toBe('new-access')
    expect(fetch).toHaveBeenCalledTimes(2)
  })
})
