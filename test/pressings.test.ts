import { afterEach, describe, expect, it, vi } from 'vitest'

const NOTES = { releaseId: 10, sides: [] }

/** A fresh copy of the module, so nothing is remembered from another test. */
async function freshPressings(...answers: (() => Promise<Response>)[]) {
  vi.resetModules()
  const fetch = vi.fn()
  for (const answer of answers) fetch.mockImplementationOnce(answer)
  vi.stubGlobal('fetch', fetch)
  return { fetch, ...(await import('../app/pressings')) }
}

const ok = () => Promise.resolve(new Response(JSON.stringify(NOTES), { status: 200 }))
const missing = () => Promise.resolve(new Response('', { status: 404 }))
const broken = () => Promise.resolve(new Response('', { status: 503 }))
const offline = () => Promise.reject(new TypeError('Failed to fetch'))

afterEach(() => vi.unstubAllGlobals())

describe('pressing notes', () => {
  it('asks only once for a release that has notes', async () => {
    const { fetch, loadPressing, knownPressing } = await freshPressings(ok)
    expect(await loadPressing(10)).toEqual(NOTES)
    expect(await loadPressing(10)).toEqual(NOTES)
    expect(knownPressing(10)).toEqual(NOTES)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('asks only once for a release that has none', async () => {
    const { fetch, loadPressing, knownPressing } = await freshPressings(missing)
    expect(await loadPressing(10)).toBeNull()
    expect(await loadPressing(10)).toBeNull()
    expect(knownPressing(10)).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('tries again after a failed load instead of remembering it as none', async () => {
    const { fetch, loadPressing, knownPressing } = await freshPressings(offline, broken, ok)
    expect(await loadPressing(10)).toBeNull()
    expect(knownPressing(10)).toBeUndefined()
    expect(await loadPressing(10)).toBeNull()
    expect(knownPressing(10)).toBeUndefined()
    expect(await loadPressing(10)).toEqual(NOTES)
    expect(fetch).toHaveBeenCalledTimes(3)
  })
})
