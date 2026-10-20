import { useState } from 'react'
import { getStore, moveManyToShelf, setSortName, useStore } from '../store'
import type { Rec } from '../types'
import { toast } from './Toast'
import { go } from '../route'
import { PressingSection } from './Pressing'
import { Tracks } from './Tracks'

/** What else there is to know or change about a record: its shelf, the name it's filed under. */
export function RecordDetails({ rec }: { rec: Rec }) {
  const store = useStore()
  const [shelfOpen, setShelfOpen] = useState(false)
  const [sortOpen, setSortOpen] = useState(false)
  if (!store) return null
  const id = rec.id
  const shelfName = store.shelves.find((s) => s.id === rec.shelf)?.name || rec.shelf

  return (
    <section className="record-extra">
      <Tracks rec={rec} />
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
      {rec.artistId && (
        <button type="button" className="row-button" onClick={() => go(`artist/${rec.artistId}`)}>
          <span>More by {rec.artist}</span>
          <span className="row-value">Albums ›</span>
        </button>
      )}
      <dl className="facts">
        {rec.label && (
          <>
            <dt>Label</dt>
            <dd>{rec.label}</dd>
          </>
        )}
        {rec.styles?.length > 0 && (
          <>
            <dt>Style</dt>
            <dd>{rec.styles.slice(0, 3).join(', ')}</dd>
          </>
        )}
        {store.local.out[id] && (
          <>
            <dt>Out since</dt>
            <dd>{timeAgo(store.local.out[id])}</dd>
          </>
        )}
      </dl>
      <PressingSection rec={rec} />
      <a className="discogs-link" href={`https://www.discogs.com/release/${rec.releaseId}`} target="_blank" rel="noreferrer">
        View on Discogs ↗
      </a>
    </section>
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

/** One cube, close up: every spine, with the record's own slot glowing. */
export function CubeStrip({
  cubeIds,
  byId,
  capacity,
  focus,
  marked,
  matched,
}: {
  cubeIds: number[]
  byId: Map<number, Rec>
  capacity: number
  focus?: number
  marked?: Set<number>
  matched?: Set<number> | null
}) {
  return (
    <div className={`strip ${matched ? 'filtering' : ''}`}>
      {cubeIds.map((cid) => {
        const r = byId.get(cid)
        if (!r) return null
        return (
          <i
            key={cid}
            className={`${cid === focus ? 'focus' : ''} ${marked?.has(cid) ? 'marked' : ''} ${matched?.has(cid) ? 'match' : ''}`}
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
