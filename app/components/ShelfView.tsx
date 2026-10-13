import { useDeferredValue, useMemo, useState } from 'react'
import { deleteShelf, moveManyToShelf, update, upsertShelf, useStore } from '../store'
import { back, go } from '../route'
import { search } from '../search'
import { cubePlace } from '../where'
import type { Rec } from '../types'
import { BackIcon, CloseIcon, SearchIcon } from './Icons'
import { Sleeve } from './Sleeve'
import { toast } from './Toast'

/**
 * One shelf: its name, where it stands on the unit, and which records are on it.
 * Records are added by finding them, and taking one off sends it back to the A–Z run.
 */
export function ShelfView({ id }: { id: string }) {
  const store = useStore()
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)
  const results = useMemo(
    () => (store && deferred ? search(store.records, deferred).filter((r) => r.shelf !== id).slice(0, 12) : []),
    [store, deferred, id],
  )
  if (!store) return null

  const shelf = store.shelves.find((s) => s.id === id)
  if (!shelf) {
    return (
      <div className="page">
        <Header />
        <p className="empty-note">That shelf isn't there any more.</p>
      </div>
    )
  }

  const isRun = id === store.map.flowShelf
  const recs = store.records.filter((r) => r.shelf === id)
  const cubes = store.built.slots.filter((c) => (isRun ? c.type === 'flow' : c.type === 'shelves' && c.shelfIds.includes(id)))
  const runName = store.shelves.find((s) => s.id === store.map.flowShelf)?.name || 'the A–Z run'

  const add = (r: Rec) => {
    const from = r.shelf
    moveManyToShelf([r.id], id)
    toast(`${r.title} — on ${shelf.name}`, { undo: () => moveManyToShelf([r.id], from) })
  }
  const remove = (r: Rec) => {
    moveManyToShelf([r.id], store.map.flowShelf)
    toast(`${r.title} — back in ${runName}`, { undo: () => moveManyToShelf([r.id], id) })
  }

  return (
    <div className="page shelf-page">
      <Header />
      <p className="eyebrow">Shelf</p>
      <NameField
        key={shelf.id}
        value={shelf.name}
        onSave={(name) => {
          upsertShelf({ ...shelf, name })
          toast(`Renamed to ${name}`)
        }}
      />
      <p className="page-sub">
        {recs.length} record{recs.length === 1 ? '' : 's'}
        {cubes.length
          ? ` · ${cubes.length === 1 ? `${cubes[0].label}, ${cubePlace(cubes[0], store.built) || 'on the unit'}` : `${cubes.length} cubes`}`
          : ''}
      </p>
      {!cubes.length && (
        <p className="error-note">
          No cube holds this shelf yet.{' '}
          <button type="button" className="link-btn" onClick={() => go('settings')}>
            Give it one
          </button>
        </p>
      )}

      {isRun ? (
        <p className="hint-note">
          Everything not on another shelf files here, A–Z. To move a record off it, add it to another shelf.
        </p>
      ) : (
        <>
          <h3 className="section-title">Add records</h3>
          <div className="search-box">
            <SearchIcon />
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Find a record to put here"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button type="button" className="icon-btn small" aria-label="Clear" onClick={() => setQuery('')}>
                <CloseIcon />
              </button>
            )}
          </div>
          {deferred && (
            <ul className="add-results">
              {results.map((r) => (
                <RecRow key={r.id} rec={r} sub={store.shelves.find((s) => s.id === r.shelf)?.name}>
                  <button type="button" className="add-btn" onClick={() => add(r)} aria-label={`Put ${r.title} here`}>
                    +
                  </button>
                </RecRow>
              ))}
              {!results.length && <p className="empty-note">Nothing else matches “{deferred}”.</p>}
            </ul>
          )}

          <h3 className="section-title">On this shelf</h3>
          {recs.length ? (
            <ul className="out-list">
              {recs.map((r) => (
                <RecRow key={r.id} rec={r}>
                  <button type="button" className="add-btn" onClick={() => remove(r)} aria-label={`Take ${r.title} off`}>
                    −
                  </button>
                </RecRow>
              ))}
            </ul>
          ) : (
            <p className="empty-note">Nothing yet. Find records above to put them here.</p>
          )}

          <button
            type="button"
            className="link-btn danger"
            onClick={() => {
              const saved = store.local
              deleteShelf(id)
              back('settings')
              toast(`${shelf.name} removed — its records are back in ${runName}`, { undo: () => update(() => saved) })
            }}
          >
            Remove this shelf
          </button>
        </>
      )}
    </div>
  )
}

function RecRow({ rec, sub, children }: { rec: Rec; sub?: string; children: React.ReactNode }) {
  return (
    <li className="out-item">
      <button type="button" className="out-main" onClick={() => go(`r/${rec.id}`)}>
        <Sleeve rec={rec} className="result-sleeve" />
        <span className="result-text">
          <span className="result-title">{rec.title}</span>
          <span className="result-artist">
            {rec.artist}
            {sub ? ` · ${sub}` : ''}
          </span>
        </span>
      </button>
      {children}
    </li>
  )
}

/** The shelf's name, edited in place; saved on Enter or when you tap away. */
function NameField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [name, setName] = useState(value)
  const commit = () => {
    const v = name.trim()
    if (!v) setName(value)
    else if (v !== value) onSave(v)
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        ;(document.activeElement as HTMLElement)?.blur()
      }}
    >
      <input
        className="text-input title-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        autoCapitalize="words"
        aria-label="Shelf name"
      />
    </form>
  )
}

function Header() {
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" onClick={() => back('settings')} aria-label="Back">
        <BackIcon />
      </button>
    </header>
  )
}
