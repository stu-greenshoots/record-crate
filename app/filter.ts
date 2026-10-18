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
 * The Unit tab's filter, kept for the browser session so it survives going into a
 * cube and back. People are indexes into one snapshot's list, so they're dropped if
 * a newer snapshot has loaded since.
 */
const KEY = 'record-crate:filter'

let saved: { filter: Filter; base: string | null } = read()
const listeners = new Set<() => void>()

function read() {
  try {
    const raw = sessionStorage.getItem(KEY)
    if (raw) {
      const v = JSON.parse(raw)
      return { filter: { ...EMPTY_FILTER, ...v.filter } as Filter, base: v.base ?? null }
    }
  } catch {
    /* ignore */
  }
  return { filter: EMPTY_FILTER as Filter, base: null }
}

export function setFilter(filter: Filter, base: string) {
  saved = { filter, base }
  try {
    sessionStorage.setItem(KEY, JSON.stringify(saved))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useFilter(base: string): Filter {
  const s = useSyncExternalStore(subscribe, () => saved)
  return s.base === base || !s.filter.people.length ? s.filter : { ...s.filter, people: [] }
}

/**
 * The records the filter lets through, or null when there's no filter, and the pool
 * the typed words leave for the other choices to narrow (and count) further.
 */
export function useMatches(records: Rec[], base: string) {
  const filter = useFilter(base)
  const pool = useMemo(() => (filter.text.trim() ? search(records, filter.text, Infinity) : records), [records, filter.text])
  // Keyed on the content: a filter with its people dropped is a new object each time.
  const key = JSON.stringify(filter)
  const matched = useMemo(
    () => (isEmpty(filter) ? null : new Set(pool.filter((r) => matches(r, filter)).map((r) => r.id))),
    [pool, key],
  )
  return { filter, matched, pool }
}
