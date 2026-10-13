import { useSyncExternalStore } from 'react'
import { buildShelfMap } from '../shared/shelfmap.js'
import type { BuiltMap, Rec, Shelf, ShelfMapConfig, Snapshot, Spot } from './types'

/**
 * Everything the app knows lives in two layers: the snapshot baked in at build time
 * (the collection, already filed), and what you've done on this phone — records out
 * of the shelf, records you've moved to another shelf, the unit's layout. The second
 * layer is saved to localStorage and always wins.
 */

export interface Local {
  version: 1
  /** id -> when it came off the shelf. */
  out: Record<string, number>
  /** Recently looked-up ids, newest first. */
  recent: number[]
  /** id -> shelf id, for records you've moved by hand. */
  shelfOf: Record<string, string>
  /** id -> the name it's filed under, where you've corrected it. */
  sortOf: Record<string, string>
  /** The shelves, once you've renamed or added any. */
  shelves: Shelf[] | null
  map: ShelfMapConfig | null
  /** The snapshot a custom layout was made against, to spot a newer one. */
  mapBase: string | null
  /** Records added on Discogs since the snapshot. */
  fresh: Rec[]
  /** Records no longer in the Discogs collection. */
  gone: number[]
  /** Cube index -> ids confirmed in place, for the organise pass. */
  sorted: Record<string, number[]>
  lastCheck: string | null
}

const KEY = 'record-crate:v1'

const EMPTY: Local = {
  version: 1,
  out: {},
  recent: [],
  shelfOf: {},
  sortOf: {},
  shelves: null,
  map: null,
  mapBase: null,
  fresh: [],
  gone: [],
  sorted: {},
  lastCheck: null,
}

function read(): Local {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...EMPTY, ...JSON.parse(raw) }
  } catch {
    /* private mode or cleared storage: start empty */
  }
  return { ...EMPTY }
}

let local = read()
let snapshot: Snapshot | null = null
let derived: Derived | null = null
const listeners = new Set<() => void>()

export interface Derived {
  snapshot: Snapshot
  local: Local
  records: Rec[]
  byId: Map<number, Rec>
  shelves: Shelf[]
  map: ShelfMapConfig
  built: BuiltMap
  spots: Map<number, Spot>
  /** Records out of the shelf, in the order you'd walk the unit to put them back. */
  out: Rec[]
}

function derive(): Derived | null {
  if (!snapshot) return null
  const gone = new Set(local.gone)
  const shelves = local.shelves || snapshot.shelves
  const map = local.map || snapshot.shelfMap
  const shelfIds = new Set(shelves.map((s) => s.id))
  // A record added from Discogs on the phone turns up in the next snapshot too.
  const inSnapshot = new Set(snapshot.records.map((r) => r.id))
  const records = [...snapshot.records, ...local.fresh.filter((r) => !inSnapshot.has(r.id))]
    .filter((r) => !gone.has(r.id))
    .map((r) => {
      const shelf = local.shelfOf[r.id] || r.shelf
      const sortName = local.sortOf[r.id] || r.sortName
      if (shelf === r.shelf && sortName === r.sortName && shelfIds.has(shelf)) return r
      // A shelf that's been deleted sends its records back to the A–Z run.
      return { ...r, sortName, shelf: shelfIds.has(shelf) ? shelf : map.flowShelf }
    })
  const byId = new Map(records.map((r) => [r.id, r]))
  const built = buildShelfMap(
    map,
    records.map((r) => ({ ...r, instanceId: r.id })),
    shelves,
  ) as unknown as BuiltMap

  /**
   * Where each record stands — including the ones out of the shelf. A record you're
   * holding keeps its slot. Its landmarks are the nearest records either side that
   * are actually on the shelf: a neighbour that's out too is no use to slide it next to.
   */
  const spots = new Map<number, Spot>()
  for (const cube of built.slots) {
    const ids = cube.instanceIds
    const landmark = (from: number, step: number) => {
      for (let i = from; i >= 0 && i < ids.length; i += step) {
        if (!local.out[ids[i]]) return byId.get(ids[i]) || null
      }
      return null
    }
    ids.forEach((id, i) => {
      spots.set(id, { cube, index: i, before: landmark(i - 1, -1), after: landmark(i + 1, 1) })
    })
  }

  const order = (r: Rec) => {
    const s = spots.get(r.id)
    return s ? s.cube.index * 10000 + s.index : 1e9
  }
  const out = Object.keys(local.out)
    .map((id) => byId.get(Number(id)))
    .filter((r): r is Rec => Boolean(r))
    .sort((a, b) => order(a) - order(b))

  return { snapshot, local, records, byId, shelves, map, built, spots, out }
}

function emit() {
  derived = derive()
  listeners.forEach((l) => l())
}

export function update(fn: (l: Local) => Local | void) {
  const draft = structuredClone(local)
  local = fn(draft) || draft
  try {
    localStorage.setItem(KEY, JSON.stringify(local))
  } catch {
    /* storage full or blocked: keep working in memory */
  }
  emit()
}

let loadError: string | null = null

export async function load() {
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/collection.json`)
    if (!res.ok) throw new Error(`Couldn't load the collection (${res.status})`)
    snapshot = await res.json()
    loadError = null
  } catch (err) {
    loadError = String((err as Error)?.message || err)
  }
  emit()
  // Ask the browser not to clear what's saved here (Safari otherwise may, after a
  // week without a visit, unless the app is on the home screen).
  navigator.storage?.persist?.().catch(() => {})
}

export function useLoadError() {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => loadError,
  )
}

export function useStore(): Derived | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => derived,
  )
}

export function getStore() {
  return derived
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

export function takeOut(id: number) {
  update((l) => {
    l.out[id] = Date.now()
  })
}

export function putBack(id: number) {
  update((l) => {
    delete l.out[id]
  })
}

export function noteLookup(id: number) {
  update((l) => {
    l.recent = [id, ...l.recent.filter((x) => x !== id)].slice(0, 12)
  })
}

/** File a record (or several) under a corrected name; the original name clears it. */
export function setSortName(ids: number[], sortName: string) {
  const name = sortName.trim()
  update((l) => {
    for (const id of ids) {
      const original = snapshot?.records.find((r) => r.id === id)?.sortName ??
        l.fresh.find((r) => r.id === id)?.sortName
      if (!name || name === original) delete l.sortOf[id]
      else l.sortOf[id] = name
    }
  })
}

/** Move records onto a shelf, by hand. */
export function moveManyToShelf(ids: number[], shelf: string) {
  update((l) => {
    for (const id of ids) {
      const original = snapshot?.records.find((r) => r.id === id)?.shelf ??
        l.fresh.find((r) => r.id === id)?.shelf
      if (shelf === original) delete l.shelfOf[id]
      else l.shelfOf[id] = shelf
    }
  })
}

export function saveShelves(shelves: Shelf[]) {
  update((l) => {
    l.shelves = shelves
  })
}

/** Rename a shelf, or add one if the id is new. */
export function upsertShelf(shelf: Shelf) {
  const current = derived?.shelves || snapshot?.shelves || []
  const exists = current.some((s) => s.id === shelf.id)
  saveShelves(exists ? current.map((s) => (s.id === shelf.id ? { ...s, ...shelf } : s)) : [...current, shelf])
}

/** Remove a shelf: its records go back to the A–Z run and its cube becomes part of it. */
export function deleteShelf(id: string) {
  update((l) => {
    const current = l.shelves || snapshot?.shelves || []
    l.shelves = current.filter((s) => s.id !== id)
    for (const [rid, sid] of Object.entries(l.shelfOf)) if (sid === id) delete l.shelfOf[rid]
    const map = l.map || (snapshot ? structuredClone(snapshot.shelfMap) : null)
    if (map?.slots.some((s) => s.shelfIds?.includes(id))) {
      map.slots = map.slots.map((s) => {
        if (s.type !== 'shelves') return s
        const rest = (s.shelfIds || []).filter((x) => x !== id)
        return rest.length ? { type: 'shelves' as const, shelfIds: rest } : { type: 'flow' as const }
      })
      l.map = map
      l.mapBase = snapshot?.exportedAt || null
    }
  })
}

export function setMap(map: ShelfMapConfig | null) {
  update((l) => {
    l.map = map
    l.mapBase = map ? snapshot?.exportedAt || null : null
    // Ticks were for the old cubes.
    l.sorted = {}
  })
}

export function toggleSorted(cube: number, id: number) {
  update((l) => {
    const list = new Set(l.sorted[cube] || [])
    if (list.has(id)) list.delete(id)
    else list.add(id)
    l.sorted[cube] = [...list]
  })
}

export function resetSorted(cube: number) {
  update((l) => {
    delete l.sorted[cube]
  })
}

/** URL for a record's sleeve: our own copy when the snapshot has one. */
export function coverUrl(r: Rec) {
  if (r.cover) return `${import.meta.env.BASE_URL}${r.cover}`
  return r.remoteCover || ''
}
