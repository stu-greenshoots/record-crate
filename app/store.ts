import { useSyncExternalStore } from 'react'
import { buildShelfMap } from '../shared/shelfmap.js'
import type { BuiltMap, Rec, ShelfMapConfig, Snapshot, Spot } from './types'

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
  map: ShelfMapConfig | null
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
  map: null,
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
  map: ShelfMapConfig
  built: BuiltMap
  spots: Map<number, Spot>
  /** Records out of the shelf, in the order you'd walk the unit to put them back. */
  out: Rec[]
}

function derive(): Derived | null {
  if (!snapshot) return null
  const gone = new Set(local.gone)
  const records = [...snapshot.records, ...local.fresh]
    .filter((r) => !gone.has(r.id))
    .map((r) => (local.shelfOf[r.id] ? { ...r, shelf: local.shelfOf[r.id] } : r))
  const byId = new Map(records.map((r) => [r.id, r]))
  const map = local.map || snapshot.shelfMap
  const built = buildShelfMap(
    map,
    records.map((r) => ({ ...r, instanceId: r.id })),
    snapshot.shelves,
  ) as unknown as BuiltMap

  /**
   * Where each record stands — including the ones out of the shelf. A record you're
   * holding keeps its slot; the neighbours either side are the two to slide it
   * between, and they don't change because it's gone.
   */
  const spots = new Map<number, Spot>()
  for (const cube of built.slots) {
    const ids = cube.instanceIds
    ids.forEach((id, i) => {
      spots.set(id, {
        cube,
        index: i,
        before: i > 0 ? byId.get(ids[i - 1]) || null : null,
        after: i < ids.length - 1 ? byId.get(ids[i + 1]) || null : null,
      })
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

  return { snapshot, local, records, byId, map, built, spots, out }
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

export async function load() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/collection.json`)
  if (!res.ok) throw new Error(`Couldn't load the collection (${res.status})`)
  snapshot = await res.json()
  emit()
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

export function moveToShelf(id: number, shelf: string, original: string) {
  update((l) => {
    if (shelf === original) delete l.shelfOf[id]
    else l.shelfOf[id] = shelf
  })
}

export function setMap(map: ShelfMapConfig | null) {
  update((l) => {
    l.map = map
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
