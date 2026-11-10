import { useMemo, useSyncExternalStore } from 'react'
import { EMPTY_FILTER, isEmpty, matches } from '../shared/filter.js'
import { search } from './search'
import type { Rec } from './types'

export interface Filter {
  /** Typed words: artist, album, label, year or catalogue number. */
  text: string
  genres: string[]
  styles: string[]
  labels: string[]
  /** Indexes into the snapshot's people. */
  people: number[]
  from: number | null
  to: number | null
}

export type Kind = 'genres' | 'styles' | 'labels' | 'people'

/**
 * A filter kept in browser storage: the Unit tab's for the session, so it survives
 * going into a cube and back; the random pick's on the phone, so "random 70s Prog"
 * stays set. People are indexes into one snapshot's list, so they're dropped if a
 * newer snapshot has loaded since.
 */
export interface FilterStore {
  set: (filter: Filter, base: string) => void
  /** The filter, outside React (for a handler). */
  get: (base: string) => Filter
  use: (base: string) => Filter
}

function filterStore(key: string, storage: () => Storage): FilterStore {
  let saved: { filter: Filter; base: string | null } = { filter: EMPTY_FILTER as Filter, base: null }
  try {
    const raw = storage().getItem(key)
    if (raw) {
      const v = JSON.parse(raw)
      saved = { filter: { ...EMPTY_FILTER, ...v.filter } as Filter, base: v.base ?? null }
    }
  } catch {
    /* ignore */
  }
  const listeners = new Set<() => void>()
  const subscribe = (l: () => void) => {
    listeners.add(l)
    return () => listeners.delete(l)
  }
  return {
    set(filter, base) {
      saved = { filter, base }
      try {
        storage().setItem(key, JSON.stringify(saved))
      } catch {
        /* ignore */
      }
      listeners.forEach((l) => l())
    },
    get(base) {
      return current(saved, base)
    },
    use(base) {
      return current(useSyncExternalStore(subscribe, () => saved), base)
    },
  }
}

function current(s: { filter: Filter; base: string | null }, base: string) {
  return s.base === base || !s.filter.people.length ? s.filter : { ...s.filter, people: [] }
}

export const unitFilter = filterStore('record-crate:filter', () => sessionStorage)
export const randomFilter = filterStore('record-crate:random', () => localStorage)

/** The records a filter lets through, typed words and all. */
export function applyFilter(records: Rec[], filter: Filter) {
  const pool = filter.text.trim() ? search(records, filter.text, Infinity) : records
  return pool.filter((r) => matches(r, filter))
}

/**
 * The records the filter lets through, or null when there's no filter, and the pool
 * the typed words leave for the other choices to narrow (and count) further.
 */
export function useMatches(records: Rec[], filter: Filter) {
  const pool = useMemo(() => (filter.text.trim() ? search(records, filter.text, Infinity) : records), [records, filter.text])
  // Keyed on the content: a filter with its people dropped is a new object each time.
  const key = JSON.stringify(filter)
  const matched = useMemo(
    () => (isEmpty(filter) ? null : new Set(pool.filter((r) => matches(r, filter)).map((r) => r.id))),
    [pool, key],
  )
  return { filter, matched, pool }
}
