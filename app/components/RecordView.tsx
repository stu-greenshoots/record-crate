import { useEffect, useState } from 'react'
import { getStore, moveManyToShelf, noteLookup, putBack, setSortName, takeOut, useStore } from '../store'
import { back, go } from '../route'
import { alongWords, cubePlace, fractionAlong, yearOf } from '../where'
import type { Rec } from '../types'
import { UnitMap } from './UnitMap'
import { Sleeve } from './Sleeve'
import { BackIcon, CheckIcon, ReturnIcon } from './Icons'
import { toast } from './Toast'

export function RecordView({ id }: { id: number }) {
  const store = useStore()
  const [shelfOpen, setShelfOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)

  useEffect(() => {
    noteLookup(id)
    window.scrollTo(0, 0)
  }, [id])

  if (!store) return null
  const rec = store.byId.get(id)
  if (!rec) {
    return (
      <div className="page">
        <Header />
        <p className="empty-note">That record isn't in the collection any more.</p>
      </div>
    )
  }

  const spot = store.spots.get(id)
  const isOut = Boolean(store.local.out[id])
  const shelfName = store.shelves.find((s) => s.id === rec.shelf)?.name || rec.shelf
  const along = spot ? fractionAlong(spot, store.byId) : 0

  const onPrimary = () => {
    if (isOut) {
      putBack(id)
      toast(`${rec.title} is back on the shelf`, { undo: () => takeOut(id) })
      back()
    } else {
      takeOut(id)
      toast(`Out of the shelf — it'll wait in Put back`, { undo: () => putBack(id) })
    }
  }

  return (
    <div className="page record-page">
      <Header />

      <section className="record-hero">
        <Sleeve rec={rec} className="hero-sleeve" eager />
        <div className="record-id">
          <h1>{rec.title}</h1>
          <p className="record-artist">{rec.artist}</p>
          <p className="record-meta">
            {[yearOf(rec), rec.format, rec.catno].filter(Boolean).join(' · ')}
          </p>
        </div>
      </section>

      {spot ? (
        <section className="where">
          <p className="eyebrow">{isOut ? 'Goes back in' : 'Lives in'}</p>
          <div className="where-head">
            <h2 className="where-label">{spot.cube.label}</h2>
            <p className="where-place">{cubePlace(spot.cube, store.built)}</p>
          </div>

          <UnitMap built={store.built} byId={store.byId} spines highlight={[spot.cube.index]} focus={id} compact />

          <div className="cube-zoom" onClick={() => go(`unit/${spot.cube.index}`)}>
            <CubeStrip cubeIds={spot.cube.instanceIds} byId={store.byId} capacity={store.built.capacity} focus={id} />
            <p className="zoom-caption">
              <strong>{spot.index + 1}</strong> of {spot.cube.count} — {alongWords(along, spot.cube.count)}
            </p>
          </div>

          <ol className="sandwich" aria-label="Slot it in between">
            <Neighbour rec={spot.before} edge="Start of the cube" />
            <li className="sandwich-me">
              <Sleeve rec={rec} className="sandwich-sleeve" />
              <span className="sandwich-text">
                <span className="sandwich-title">{rec.title}</span>
                <span className="sandwich-sub">goes here</span>
              </span>
            </li>
            <Neighbour rec={spot.after} edge="End of the cube" />
          </ol>
        </section>
      ) : (
        <section className="where">
          <p className="empty-note">
            This shelf ({shelfName}) isn't on the unit. Give it a cube in Unit → Settings.
          </p>
        </section>
      )}

      <div className="record-actions">
        <button type="button" className={`btn btn-big ${isOut ? 'btn-primary' : 'btn-secondary'}`} onClick={onPrimary}>
          {isOut ? <CheckIcon /> : <ReturnIcon />}
          {isOut ? 'Put it back' : 'Taking it out'}
        </button>
        {isOut && <p className="action-hint">Out since {timeAgo(store.local.out[id])}</p>}
      </div>

      <section className="record-extra">
        <button type="button" className="row-button" onClick={() => setShelfOpen((v) => !v)}>
          <span>Shelf</span>
          <span className="row-value">{shelfName}</span>
        </button>
        {shelfOpen && (
          <div className="chips">
            {store.shelves.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`chip ${s.id === rec.shelf ? 'on' : ''}`}
                onClick={() => {
                  const from = rec.shelf
                  moveManyToShelf([id], s.id)
                  setShelfOpen(false)
                  if (s.id !== from) toast(`Moved to ${s.name}${whereNow(id)}`, { undo: () => moveManyToShelf([id], from) })
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="row-button" onClick={() => setSortOpen((v) => !v)}>
          <span>Filed as</span>
          <span className="row-value">
            {rec.sortName}
            {store.local.sortOf[id] ? ' ✎' : ''}
          </span>
        </button>
        {sortOpen && <SortEditor rec={rec} onDone={() => setSortOpen(false)} />}
        <dl className="facts">
          {rec.label && (
            <>
              <dt>Label</dt>
              <dd>{rec.label}</dd>
            </>
          )}
          {rec.year && rec.originalYear && rec.year !== rec.originalYear && (
            <>
              <dt>This pressing</dt>
              <dd>{rec.year}</dd>
            </>
          )}
          {rec.styles?.length > 0 && (
            <>
              <dt>Style</dt>
              <dd>{rec.styles.slice(0, 3).join(', ')}</dd>
            </>
          )}
        </dl>
        <a className="discogs-link" href={`https://www.discogs.com/release/${rec.releaseId}`} target="_blank" rel="noreferrer">
          View on Discogs ↗
        </a>
      </section>
    </div>
  )
}

/** ", now in K – M" — where a record has ended up after an edit. */
function whereNow(id: number) {
  const cube = getStore()?.spots.get(id)?.cube
  return cube ? `, now in ${cube.label}` : ''
}

/**
 * Correct the name a record is filed under — "Smith, Patti" rather than "Patti
 * Smith". Usually it's the artist that's wrong, so it fixes all their records at once.
 */
function SortEditor({ rec, onDone }: { rec: Rec; onDone: () => void }) {
  const store = useStore()!
  const [name, setName] = useState(rec.sortName)
  const siblings = store.records.filter((r) => r.artist === rec.artist && r.sortName === rec.sortName)
  const [all, setAll] = useState(siblings.length > 1)
  const original =
    store.snapshot.records.find((r) => r.id === rec.id)?.sortName ??
    store.local.fresh.find((r) => r.id === rec.id)?.sortName ??
    rec.sortName

  const save = (value: string) => {
    const ids = all ? siblings.map((r) => r.id) : [rec.id]
    const before = new Map(ids.map((i) => [i, store.byId.get(i)!.sortName]))
    setSortName(ids, value)
    onDone()
    toast(`Filed as ${value.trim() || original}${whereNow(rec.id)}`, {
      undo: () => before.forEach((n, i) => setSortName([i], n)),
    })
  }

  return (
    <form
      className="edit-box"
      onSubmit={(e) => {
        e.preventDefault()
        save(name)
      }}
    >
      <input
        className="text-input"
        value={name}
        autoFocus
        autoCapitalize="words"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        aria-label="Filed as"
      />
      <p className="edit-hint">Filed by this name, then by year. People usually go surname first: “Smith, Patti”.</p>
      {siblings.length > 1 && (
        <label className="check-row">
          <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} />
          All {siblings.length} records by {rec.artist}
        </label>
      )}
      <div className="edit-actions">
        <button type="submit" className="btn btn-primary btn-small" disabled={!name.trim() || name.trim() === rec.sortName}>
          Save
        </button>
        {rec.sortName !== original && (
          <button type="button" className="link-btn" onClick={() => save(original)}>
            Back to “{original}”
          </button>
        )}
      </div>
    </form>
  )
}

function Header() {
  return (
    <header className="topbar">
      <button type="button" className="icon-btn" onClick={() => back()} aria-label="Back">
        <BackIcon />
      </button>
    </header>
  )
}

function Neighbour({ rec, edge }: { rec: Rec | null; edge: string }) {
  if (!rec) return <li className="sandwich-edge">{edge}</li>
  return (
    <li>
      <button type="button" className="sandwich-row" onClick={() => go(`r/${rec.id}`, true)}>
        <Sleeve rec={rec} className="sandwich-sleeve" />
        <span className="sandwich-text">
          <span className="sandwich-title">{rec.title}</span>
          <span className="sandwich-sub">
            {rec.artist}
            {yearOf(rec) ? ` · ${yearOf(rec)}` : ''}
          </span>
        </span>
      </button>
    </li>
  )
}

/** One cube, close up: every spine, with the record's own slot glowing. */
export function CubeStrip({
  cubeIds,
  byId,
  capacity,
  focus,
  marked,
}: {
  cubeIds: number[]
  byId: Map<number, Rec>
  capacity: number
  focus?: number
  marked?: Set<number>
}) {
  return (
    <div className="strip">
      {cubeIds.map((cid) => {
        const r = byId.get(cid)
        if (!r) return null
        return (
          <i
            key={cid}
            className={`${cid === focus ? 'focus' : ''} ${marked?.has(cid) ? 'marked' : ''}`}
            style={{
              width: `${(r.width / capacity) * 100}%`,
              height: `${Math.min(1, r.height) * 100}%`,
              background: r.colour || undefined,
            }}
          />
        )
      })}
    </div>
  )
}

export function timeAgo(ts: number) {
  const s = (Date.now() - ts) / 1000
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return d === 1 ? 'yesterday' : `${d} days ago`
}
