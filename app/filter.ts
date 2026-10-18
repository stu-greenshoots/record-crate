import { useMemo, useSyncExternalStore } from 'react'
import { EMPTY_FILTER, isEmpty, matches } from '../shared/filter.js'
import type { Rec } from './types'

export interface Filter {
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

/** The records the filter lets through, or null when there's no filter. */
export function useMatches(records: Rec[], base: string) {
  const filter = useFilter(base)
  // Keyed on the content: a filter with its people dropped is a new object each time.
  const key = JSON.stringify(filter)
  const matched = useMemo(
    () => (isEmpty(filter) ? null : new Set(records.filter((r) => matches(r, filter)).map((r) => r.id))),
    [records, key],
  )
  return { filter, matched }
}
