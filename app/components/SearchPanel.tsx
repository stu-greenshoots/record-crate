import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { search } from '../search'
import { yearOf } from '../where'
import type { Rec } from '../types'
import type { Derived } from '../store'
import { Sleeve } from './Sleeve'
import { CloseIcon, SearchIcon } from './Icons'

const QUERY_KEY = 'record-crate:query'

/** Type to find a record; picking one puts it on the platter. */
export function SearchPanel({
  onPick,
  onClose,
  autoFocus = false,
}: {
  onPick: (rec: Rec) => void
  onClose?: () => void
  autoFocus?: boolean
}) {
  const store = useStore()
  const [query, setQuery] = useState(() => {
    try {
      return sessionStorage.getItem(QUERY_KEY) || ''
    } catch {
      return ''
    }
  })
  const deferred = useDeferredValue(query)
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      sessionStorage.setItem(QUERY_KEY, query)
    } catch {
      /* ignore */
    }
  }, [query])

  const results = useMemo(() => (store ? search(store.records, deferred) : []), [store, deferred])
  if (!store) return null

  const pick = (rec: Rec) => {
    setQuery('')
    onPick(rec)
  }

  return (
    <div className="search-panel">
      <div className="search-box">
        <SearchIcon />
        <input
          ref={input}
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          autoFocus={autoFocus}
          aria-label="Find a record"
          placeholder="Artist, album or catalogue no."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) pick(results[0])
            if (e.key === 'Escape') onClose?.()
          }}
        />
        {(query || onClose) && (
          <button
            type="button"
            className="icon-btn small"
            aria-label={query ? 'Clear' : 'Close search'}
            onClick={() => {
              if (query) {
                setQuery('')
                input.current?.focus()
              } else onClose?.()
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>
      {deferred && (
        <div className="search-results">
          {results.length ? (
            <ul className="results">
              {results.map((r) => (
                <ResultRow key={r.id} rec={r} store={store} onPick={pick} />
              ))}
            </ul>
          ) : (
            <p className="empty-note">Nothing matches “{deferred}”.</p>
          )}
        </div>
      )}
    </div>
  )
}

export function ResultRow({ rec, store, onPick }: { rec: Rec; store: Derived; onPick: (rec: Rec) => void }) {
  const spot = store.spots.get(rec.id)
  const isOut = Boolean(store.local.out[rec.id])
  return (
    <li>
      <button type="button" className="result" onClick={() => onPick(rec)}>
        <Sleeve rec={rec} className="result-sleeve" />
        <span className="result-text">
          <span className="result-title">{rec.title}</span>
          <span className="result-artist">
            {rec.artist}
            {yearOf(rec) ? ` · ${yearOf(rec)}` : ''}
          </span>
        </span>
        <span className={`cube-chip ${isOut ? 'out' : ''}`}>{isOut ? 'Out' : spot?.cube.label || '—'}</span>
      </button>
    </li>
  )
}
