import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { EMPTY_FILTER, counts, toggle } from '../../shared/filter.js'
import { setFilter, type Filter, type Kind } from '../filter'
import { fold } from '../search'
import { yearOf } from '../where'
import type { Derived } from '../store'
import type { Rec } from '../types'
import { CheckIcon, CloseIcon, SearchIcon } from './Icons'

type Sheet = Kind | 'year'

const NAMES: Record<Sheet, string> = {
  genres: 'Genre',
  styles: 'Style',
  year: 'Year',
  labels: 'Label',
  people: 'People',
}

function yearText(f: Filter) {
  if (f.from != null && f.to != null) return f.from === f.to ? `${f.from}` : `${f.from}–${f.to}`
  if (f.from != null) return `${f.from} on`
  if (f.to != null) return `up to ${f.to}`
  return ''
}

/** What to look for on the unit: one button per kind, the choices as chips beneath. */
export function FilterBar({
  store,
  filter,
  matched,
  pool,
}: {
  store: Derived
  filter: Filter
  matched: Set<number> | null
  /** What the typed words leave, for the choices to count against. */
  pool: Rec[]
}) {
  const [sheet, setSheet] = useState<Sheet | null>(null)
  const base = store.snapshot.exportedAt
  const people = store.snapshot.people || []
  const set = (f: Filter) => setFilter(f, base)

  const chosen: { key: string; text: string; drop: () => void }[] = []
  for (const kind of ['genres', 'styles', 'labels', 'people'] as Kind[]) {
    for (const v of filter[kind] as (string | number)[]) {
      chosen.push({
        key: `${kind}:${v}`,
        text: kind === 'people' ? people[v as number]?.[0] || '?' : String(v),
        drop: () => set(toggle(filter, kind, v)),
      })
    }
    if (kind === 'styles' && yearText(filter)) {
      chosen.push({ key: 'year', text: yearText(filter), drop: () => set({ ...filter, from: null, to: null }) })
    }
  }

  const cubes = matched ? store.built.slots.filter((c) => c.instanceIds.some((id) => matched.has(id))).length : 0

  return (
    <div className="filter-bar">
      <div className="search-box">
        <SearchIcon />
        <input
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label="Find on the unit"
          placeholder="Artist, album or catalogue no."
          value={filter.text}
          onChange={(e) => set({ ...filter, text: e.target.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
        />
        {filter.text && (
          <button type="button" className="icon-btn small" aria-label="Clear" onClick={() => set({ ...filter, text: '' })}>
            <CloseIcon />
          </button>
        )}
      </div>
      <div className="filter-kinds" role="group" aria-label="Filter by">
        {(Object.keys(NAMES) as Sheet[]).map((k) => {
          const n = k === 'year' ? (yearText(filter) ? 1 : 0) : filter[k].length
          return (
            <button key={k} type="button" className={`chip ${n ? 'on' : ''}`} onClick={() => setSheet(k)}>
              {NAMES[k]}
              {n > 1 ? ` · ${n}` : ''}
            </button>
          )
        })}
      </div>
      {matched && (
        <>
          {chosen.length > 0 && (
            <div className="filter-chosen">
              {chosen.map((c) => (
                <button key={c.key} type="button" className="filter-chip" onClick={c.drop} aria-label={`Remove ${c.text}`}>
                  {c.text}
                  <CloseIcon />
                </button>
              ))}
            </div>
          )}
          <p className="filter-summary">
            {matched.size === 0
              ? 'Nothing matches all of these.'
              : `${matched.size} record${matched.size === 1 ? '' : 's'} in ${cubes} cube${cubes === 1 ? '' : 's'}`}
            <button type="button" className="link-btn" onClick={() => set(EMPTY_FILTER as Filter)}>
              Clear
            </button>
          </p>
        </>
      )}
      {sheet && (
        <div className="search-sheet filter-sheet" role="dialog" aria-label={`Filter by ${NAMES[sheet]}`}>
          <div className="filter-sheet-head">
            <h2>{NAMES[sheet]}</h2>
            <span className="filter-sheet-count">
              {matched ? `${matched.size} record${matched.size === 1 ? '' : 's'}` : `${store.records.length} records`}
            </span>
            <button type="button" className="btn btn-small btn-mustard" onClick={() => setSheet(null)}>
              Done
            </button>
          </div>
          {sheet === 'year' ? (
            <YearPicker store={store} filter={filter} set={set} />
          ) : (
            <Options store={store} pool={pool} filter={filter} kind={sheet} set={set} />
          )}
        </div>
      )}
    </div>
  )
}

function Options({
  store,
  pool,
  filter,
  kind,
  set,
}: {
  store: Derived
  pool: Rec[]
  filter: Filter
  kind: Kind
  set: (f: Filter) => void
}) {
  const [query, setQuery] = useState('')
  const q = fold(useDeferredValue(query))
  const people = store.snapshot.people || []
  const n = useMemo(() => counts(pool, filter, kind) as Map<string | number, number>, [pool, filter, kind])

  const options = useMemo(() => {
    const picked = new Set<string | number>(filter[kind])
    const name = (v: string | number) => (kind === 'people' ? people[v as number]?.[0] || '' : String(v))
    let list = [...n.keys()]
    if (q) list = list.filter((v) => ` ${fold(name(v))}`.includes(` ${q}`) || (q.length > 2 && fold(name(v)).includes(q)))
    list.sort(
      (a, b) =>
        Number(picked.has(b)) - Number(picked.has(a)) || (n.get(b) || 0) - (n.get(a) || 0) || name(a).localeCompare(name(b)),
    )
    // Thousands of people: the ones on most records until you type a name.
    return list.slice(0, kind === 'people' && !q ? 60 : 300).map((v) => ({ v, name: name(v) }))
  }, [n, q, kind, filter, people])

  if (kind === 'people' && !people.length) {
    return (
      <p className="empty-note">
        This copy of the collection was saved before people were added. Close the app and open it again (with a
        signal) to fetch the new one.
      </p>
    )
  }

  return (
    <>
      <div className="search-box">
        <SearchIcon />
        <input
          type="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={`Find a ${NAMES[kind].toLowerCase()}`}
          placeholder={kind === 'people' ? 'A player, engineer or producer' : `Find a ${NAMES[kind].toLowerCase()}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      {kind === 'people' && !q && <p className="hint-note">The people on most of your records. Type to find anyone else.</p>}
      <ul className="filter-options">
        {options.map(({ v, name }) => {
          const on = (filter[kind] as (string | number)[]).includes(v)
          const count = n.get(v) || 0
          return (
            <li key={String(v)}>
              <button
                type="button"
                className={`filter-option ${on ? 'on' : ''}`}
                disabled={!on && !count}
                aria-pressed={on}
                onClick={() => set(toggle(filter, kind, v))}
              >
                <span className="filter-option-text">
                  <span className="filter-option-name">{name}</span>
                  {kind === 'people' && <span className="filter-option-sub">{people[v as number]?.[1]}</span>}
                </span>
                <span className="filter-option-count">{count}</span>
                <span className="filter-option-tick">{on && <CheckIcon />}</span>
              </button>
            </li>
          )
        })}
      </ul>
      {!options.length && <p className="empty-note">Nothing called “{query}”.</p>}
    </>
  )
}

function YearPicker({ store, filter, set }: { store: Derived; filter: Filter; set: (f: Filter) => void }) {
  const years = store.records.map(yearOf).filter((y): y is number => y != null)
  const first = Math.floor(Math.min(...years) / 10) * 10
  const last = Math.floor(Math.max(...years) / 10) * 10
  const decades: number[] = []
  for (let d = first; d <= last; d += 10) decades.push(d)
  const num = (s: string) => (/^\d{4}$/.test(s) ? Number(s) : null)

  return (
    <>
      <div className="chips">
        {decades.map((d) => {
          const on = filter.from === d && filter.to === d + 9
          return (
            <button
              key={d}
              type="button"
              className={`chip ${on ? 'on' : ''}`}
              onClick={() => set(on ? { ...filter, from: null, to: null } : { ...filter, from: d, to: d + 9 })}
            >
              {d}s
            </button>
          )
        })}
      </div>
      <div className="year-range">
        <label>
          From
          <YearInput value={filter.from} onChange={(s) => set({ ...filter, from: num(s) })} />
        </label>
        <label>
          To
          <YearInput value={filter.to} onChange={(s) => set({ ...filter, to: num(s) })} />
        </label>
      </div>
      <p className="hint-note">The year it first came out, where Discogs knows it, rather than your pressing.</p>
    </>
  )
}

/** Holds half-typed years, so "19" doesn't clear the filter on the way to "1975". */
function YearInput({ value, onChange }: { value: number | null; onChange: (s: string) => void }) {
  const [text, setText] = useState(value == null ? '' : String(value))
  // Follow changes made elsewhere (a decade tapped, a chip removed).
  useEffect(() => {
    const now = value == null ? '' : String(value)
    if (now !== text && (value != null || text.length === 4)) setText(now)
  }, [value])
  return (
    <input
      type="text"
      inputMode="numeric"
      maxLength={4}
      placeholder="Any"
      value={text}
      onChange={(e) => {
        const s = e.target.value.replace(/\D/g, '')
        setText(s)
        if (s.length === 4 || s === '') onChange(s)
      }}
    />
  )
}
