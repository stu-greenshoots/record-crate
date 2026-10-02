import { useEffect, useMemo, useRef, useState } from 'react'
import { api, img } from '../api'
import type { RecordSummary, Shelf, ShelfMap, ShelfSlot } from '../types'

interface Props {
  records: RecordSummary[]
  shelves: Shelf[]
  query: string
  onOpen: (r: RecordSummary) => void
  onChanged: () => void
}

/* ------------------------------------------------------------------ */
/* Spine colours, sampled from the sleeve art                          */
/* ------------------------------------------------------------------ */

const colourCache = new Map<string, string>()

/**
 * Average each sleeve down to one colour so a packed cube reads like a real row of
 * spines. The art is served from our own proxy, so the canvas stays untainted.
 */
function useSpineColours(records: RecordSummary[]) {
  const [, bump] = useState(0)
  const pending = useRef(new Set<string>())

  useEffect(() => {
    let live = true
    const todo = records
      .map((r) => r.thumb || r.cover)
      .filter((src): src is string => Boolean(src) && !colourCache.has(src) && !pending.current.has(src))

    if (!todo.length) return
    let done = 0

    const sample = (src: string) =>
      new Promise<void>((resolve) => {
        pending.current.add(src)
        const image = new Image()
        image.crossOrigin = 'anonymous'
        image.decoding = 'async'
        const finish = (colour: string) => {
          colourCache.set(src, colour)
          pending.current.delete(src)
          if (live && ++done % 20 === 0) bump((v) => v + 1)
          resolve()
        }
        image.onload = () => {
          try {
            const canvas = document.createElement('canvas')
            canvas.width = 8
            canvas.height = 8
            const ctx = canvas.getContext('2d', { willReadFrequently: true })!
            ctx.drawImage(image, 0, 0, 8, 8)
            const { data } = ctx.getImageData(0, 0, 8, 8)
            let r = 0
            let g = 0
            let b = 0
            for (let i = 0; i < data.length; i += 4) {
              r += data[i]
              g += data[i + 1]
              b += data[i + 2]
            }
            const n = data.length / 4
            finish(`rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`)
          } catch {
            finish('#3a332c')
          }
        }
        image.onerror = () => finish('#3a332c')
        image.src = img(src)
      })

    // A few at a time — hundreds of simultaneous loads stalls the tab and swamps
    // a tunnelled connection.
    const queue = [...todo]
    const workers = Array.from({ length: 6 }, async () => {
      while (live) {
        const next = queue.shift()
        if (!next) return
        await sample(next)
      }
    })
    Promise.all(workers).then(() => live && bump((v) => v + 1))

    return () => {
      live = false
    }
  }, [records])

  return (src: string | null | undefined) => (src && colourCache.get(src)) || '#3a332c'
}

/* ------------------------------------------------------------------ */

function Cube({
  slot,
  records,
  capacity,
  colourOf,
  matches,
  onOpen,
  onEdit,
}: {
  slot: ShelfSlot
  records: RecordSummary[]
  capacity: number
  colourOf: (src: string | null | undefined) => string
  matches: Set<number> | null
  onOpen: (r: RecordSummary) => void
  onEdit: () => void
}) {
  const [hover, setHover] = useState<RecordSummary | null>(null)
  // Measured in shelf width, so a gatefold double counts for more than a thin single.
  const used = records.reduce((a, r) => a + (r.width ?? 1), 0)
  const fill = Math.min(1, used / Math.max(capacity, 1))
  // Real records lean when a cube isn't full.
  const lean = records.length > 4 && fill < 0.82
  /**
   * Spines are drawn to scale against what the cube holds, not divided evenly between
   * however many records are in it — so a half-empty cube reads as half empty, and a
   * double album is visibly fatter than the single next to it.
   */
  const scale = Math.max(capacity, used, 1)

  return (
    <div className={`cube ${slot.over ? 'over' : ''}`}>
      <div className="cube-inner">
        <div className={`spines ${lean ? 'leaning' : ''}`}>
          {records.map((r) => {
            const dim = matches ? !matches.has(r.instanceId) : false
            return (
              <button
                key={r.instanceId}
                className={`spine ${r.isBox ? 'box' : ''} ${dim ? 'dim' : ''} ${matches && !dim ? 'hit' : ''}`}
                style={{
                  background: colourOf(r.thumb || r.cover),
                  flexBasis: `${((r.width ?? 1) / scale) * 100}%`,
                  // 7"s and cassettes stand short, the way they do on a real shelf.
                  height: `${(r.height ?? 1) * 100}%`,
                }}
                onMouseEnter={() => setHover(r)}
                onMouseLeave={() => setHover((h) => (h === r ? null : h))}
                onClick={() => onOpen(r)}
                title={`${r.artist} — ${r.title}`}
              />
            )
          })}
          {!records.length && <span className="cube-empty">empty</span>}
        </div>

        {hover && (
          <div className="spine-peek">
            {hover.cover && <img src={img(hover.cover)} alt="" />}
            <div className="spine-peek-text">
              <strong>{hover.title}</strong>
              <span>{hover.artist}</span>
            </div>
          </div>
        )}
      </div>

      <div className="cube-label">
        <button className="cube-name" onClick={onEdit} title="Change what this cube holds">
          {slot.label}
        </button>
        <span className={`cube-count ${slot.over ? 'over' : ''}`}>
          {slot.count}
          {slot.width != null && slot.width !== slot.count && (
            <em title="shelf width in standard-LP widths"> · {slot.width}w</em>
          )}
          {slot.over && <em> over</em>}
        </span>
      </div>
      <div className="cube-bar">
        <span style={{ width: `${Math.min(100, fill * 100)}%` }} />
      </div>
    </div>
  )
}

export function Unit({ records, shelves, query, onOpen, onChanged }: Props) {
  const [map, setMap] = useState<ShelfMap | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const colourOf = useSpineColours(records)
  const scrollRef = useRef<HTMLDivElement>(null)
  const noteRef = useRef<HTMLParagraphElement>(null)
  const [unitMax, setUnitMax] = useState<number>()

  const cols = map?.cols
  const rows = map?.rows

  /**
   * Size the unit from the space actually available rather than a fixed width, so
   * the whole thing is visible at a glance. Measured, because the header, controls
   * and footnote all change height as they wrap.
   */
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !rows || !cols) return
    const GAP = 14
    const LABEL = 50
    const FRAME = 28
    // Below this the spines are too fine to hover, so scroll instead of shrinking.
    const MIN_CUBE = 140

    const measure = () => {
      const cs = getComputedStyle(el)
      const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      const note = (noteRef.current?.offsetHeight ?? 0) + 26
      const available = el.clientHeight - padding - note - FRAME
      const cubeHeight = Math.max(
        MIN_CUBE,
        (available - (rows - 1) * GAP - rows * LABEL) / rows,
      )
      const width = cubeHeight * 1.05 * cols + (cols - 1) * GAP + FRAME
      const next = Math.round(Math.max(cols * 116, Math.min(1180, width)))
      setUnitMax((prev) => (prev && Math.abs(prev - next) < 2 ? prev : next))
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [rows, cols])

  const byId = useMemo(() => new Map(records.map((r) => [r.instanceId, r])), [records])

  const load = () => api.shelfMap().then(setMap)
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return null
    return new Set(
      records
        .filter((r) =>
          [r.title, r.artist, r.sortName, r.label, r.catno].join(' ').toLowerCase().includes(q),
        )
        .map((r) => r.instanceId),
    )
  }, [records, query])

  async function patch(body: Record<string, unknown>) {
    setMap(await api.setShelfMap(body))
    onChanged()
  }

  if (!map) return <div className="empty" />

  const unplaced = map.unplaced.length

  return (
    <div className="unit-wrap">
      <div className="unit-controls">
        <label>
          <span>Across</span>
          <input
            type="number"
            min={1}
            max={8}
            value={map.cols}
            onChange={(e) => patch({ cols: Number(e.target.value) })}
          />
        </label>
        <label>
          <span>Down</span>
          <input
            type="number"
            min={1}
            max={8}
            value={map.rows}
            onChange={(e) => patch({ rows: Number(e.target.value) })}
          />
        </label>
        <label>
          <span title="In standard-LP widths: a gatefold double counts about 2.4">Fits per cube</span>
          <input
            type="number"
            min={1}
            max={500}
            value={map.capacity}
            onChange={(e) => patch({ capacity: Number(e.target.value) })}
          />
        </label>
        <div className="spacer" />
        {unplaced > 0 && (
          <span className="unit-warn">
            {unplaced} record{unplaced === 1 ? '' : 's'} not on the unit
          </span>
        )}
        <button
          className="btn btn-ghost btn-sm"
          onClick={async () => {
            setMap(await api.resetShelfMap())
            onChanged()
          }}
        >
          Reset layout
        </button>
      </div>

      <div className="unit-scroll" ref={scrollRef}>
        <div
          className="unit"
          style={
            {
              gridTemplateColumns: `repeat(${map.cols}, minmax(0, 1fr))`,
              // Below this the spines stop being legible, so scroll rather than squash.
              minWidth: map.cols * 116,
              maxWidth: unitMax,
            } as React.CSSProperties
          }
        >
          {map.slots.map((slot) => (
            <Cube
              key={slot.index}
              slot={slot}
              capacity={map.capacity}
              records={slot.instanceIds.map((id) => byId.get(id)).filter(Boolean) as RecordSummary[]}
              colourOf={colourOf}
              matches={matches}
              onOpen={onOpen}
              onEdit={() => setEditing(slot.index)}
            />
          ))}
        </div>

        <p className="unit-note" ref={noteRef}>
          Lettered cubes hold {shelves.find((s) => s.id === map.flowShelf)?.name ?? 'the main shelf'}
          , filled in filed order and balanced by the shelf space each record actually takes — a
          gatefold double counts for roughly two thin singles. Letters stay whole unless one
          outgrows a cube, and the ranges shift on their own as the collection grows. Click a
          cube's label to change what it holds.
        </p>
      </div>

      {editing != null && (
        <CubeEditor
          slot={map.slots[editing]}
          shelves={shelves}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            const slots = map.slots.map((s) =>
              s.index === editing
                ? next
                : { type: s.type, shelfIds: s.shelfIds } as { type: string; shelfIds: string[] },
            )
            await patch({ slots })
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

function CubeEditor({
  slot,
  shelves,
  onClose,
  onSave,
}: {
  slot: ShelfSlot
  shelves: Shelf[]
  onClose: () => void
  onSave: (next: { type: string; shelfIds: string[] }) => void
}) {
  const [type, setType] = useState(slot.type)
  const [ids, setIds] = useState<string[]>(slot.shelfIds || [])

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mini-sheet">
        <h3>
          Cube {slot.index + 1} <span>row {slot.row + 1}, column {slot.col + 1}</span>
        </h3>

        <div className="chips" style={{ margin: '18px 0' }}>
          <button
            className={`chip ${type === 'flow' ? 'on' : ''}`}
            onClick={() => setType('flow')}
          >
            Part of the alphabetical run
          </button>
          <button
            className={`chip ${type === 'shelves' ? 'on' : ''}`}
            onClick={() => setType('shelves')}
          >
            A specific shelf
          </button>
        </div>

        {type === 'shelves' && (
          <>
            <h4 className="mini-label">Holds</h4>
            <div className="chips">
              {shelves.map((s) => (
                <button
                  key={s.id}
                  className={`chip ${ids.includes(s.id) ? 'on' : ''}`}
                  onClick={() =>
                    setIds((cur) =>
                      cur.includes(s.id) ? cur.filter((x) => x !== s.id) : [...cur, s.id],
                    )
                  }
                >
                  {s.name}
                </button>
              ))}
            </div>
            <p className="mini-hint">Pick more than one to share a cube.</p>
          </>
        )}

        <div className="mini-actions">
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => onSave({ type, shelfIds: type === 'shelves' ? ids : [] })}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
