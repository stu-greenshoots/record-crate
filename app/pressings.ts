import type { Pressing } from './types'

const cache = new Map<number, Pressing | null>()

/** What's already known about a release's pressing notes: undefined if not asked yet. */
export function knownPressing(releaseId: number): Pressing | null | undefined {
  return cache.get(releaseId)
}

/**
 * The pressing notes for a release, fetched once and kept (null where there are none).
 * A failed load gives null too, but isn't kept, so the next look tries again.
 */
export async function loadPressing(releaseId: number): Promise<Pressing | null> {
  if (cache.has(releaseId)) return cache.get(releaseId)!
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}pressings/${releaseId}.json`)
    if (!res.ok && res.status !== 404) return null
    const p: Pressing | null = res.ok ? await res.json() : null
    cache.set(releaseId, p)
    return p
  } catch {
    return null
  }
}
