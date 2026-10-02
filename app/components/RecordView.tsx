import { useEffect, useState } from 'react'
import { moveToShelf, noteLookup, putBack, takeOut, useStore } from '../store'
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
  const original = store.snapshot.records.find((r) => r.id === id)?.shelf || rec.shelf
  const shelfName = store.snapshot.shelves.find((s) => s.id === rec.shelf)?.name || rec.shelf
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
            {store.snapshot.shelves.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`chip ${s.id === rec.shelf ? 'on' : ''}`}
                onClick={() => {
                  moveToShelf(id, s.id, original)
                  setShelfOpen(false)
                  if (s.id !== rec.shelf) toast(`Moved to ${s.name}`)
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
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
          <dt>Filed as</dt>
          <dd>{rec.sortName}</dd>
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
