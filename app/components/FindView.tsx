import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { go } from '../route'
import { search } from '../search'
import { warmUp } from '../recognise'
import { yearOf } from '../where'
import type { Rec } from '../types'
import type { Derived } from '../store'
import { Sleeve } from './Sleeve'
import { CameraIcon, ChevronIcon, CloseIcon, SearchIcon } from './Icons'

const QUERY_KEY = 'record-crate:query'

export function FindView() {
  const store = useStore()
  const [query, setQuery] = useState(() => sessionStorage.getItem(QUERY_KEY) || '')
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

  if (!store) return <Loading />

  const recent = store.local.recent.map((id) => store.byId.get(id)).filter((r): r is Rec => Boolean(r))

  return (
    <div className="page find-page">
      <header className="brand">
        <span className="brand-mark" aria-hidden />
        <span className="brand-name">Record Crate</span>
        <span className="brand-count">{store.records.length} records</span>
      </header>

      <button
        type="button"
        className="scan-card"
        onPointerDown={() => warmUp()}
        onClick={() => go('scan')}
      >
        <span className="scan-icon">
          <CameraIcon />
        </span>
        <span className="scan-text">
          <strong>Point at a sleeve</strong>
          <span>Find out where it lives</span>
        </span>
        <ChevronIcon />
      </button>

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
          placeholder="Artist, album or catalogue no."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && results[0]) go(`r/${results[0].id}`)
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-btn small"
            aria-label="Clear"
            onClick={() => {
              setQuery('')
              input.current?.focus()
            }}
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {deferred ? (
        results.length ? (
          <ul className="results">
            {results.map((r) => (
              <ResultRow key={r.id} rec={r} store={store} />
            ))}
          </ul>
        ) : (
          <p className="empty-note">Nothing matches “{deferred}”.</p>
        )
      ) : (
        <>
          {store.out.length > 0 && (
            <button type="button" className="out-banner" onClick={() => go('out')}>
              <span className="out-sleeves">
                {store.out.slice(0, 4).map((r) => (
                  <Sleeve key={r.id} rec={r} />
                ))}
              </span>
              <span className="out-text">
                <strong>
                  {store.out.length} out of the shelf
                </strong>
                <span>Put them back in order</span>
              </span>
              <ChevronIcon />
            </button>
          )}
          {recent.length > 0 && (
            <>
              <h3 className="section-title">Recently looked up</h3>
              <ul className="results">
                {recent.map((r) => (
                  <ResultRow key={r.id} rec={r} store={store} />
                ))}
              </ul>
            </>
          )}
          {!recent.length && !store.out.length && (
            <p className="hint-note">
              Pull a record off the shelf, find it here, and tap <em>Taking it out</em>. When you're done
              listening, <em>Put back</em> shows you exactly where everything goes.
            </p>
          )}
        </>
      )}
    </div>
  )
}

export function ResultRow({ rec, store }: { rec: Rec; store: Derived }) {
  const spot = store.spots.get(rec.id)
  const isOut = Boolean(store.local.out[rec.id])
  return (
    <li>
      <button type="button" className="result" onClick={() => go(`r/${rec.id}`)}>
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

function Loading() {
  return (
    <div className="page loading">
      <span className="spinner-disc" />
    </div>
  )
}
