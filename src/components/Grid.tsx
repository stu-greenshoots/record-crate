import { Fragment, useRef, useState } from 'react'
import type { RecordSummary } from '../types'
import { Sleeve } from './Sleeve'

interface Props {
  records: RecordSummary[]
  sortMode: string
  currency: string
  onOpen: (r: RecordSummary) => void
  onReorder: (ordered: RecordSummary[]) => void
  onDragStateChange: (r: RecordSummary | null) => void
}

/** The letter a record files under, for the run-in dividers. */
function letterFor(r: RecordSummary, mode: string): string | null {
  const source = mode === 'smart' ? r.sortName : mode === 'artist' ? r.artist : mode === 'title' ? r.title : null
  if (!source) return null
  const ch = source.trim()[0]?.toUpperCase() ?? ''
  return /[A-Z]/.test(ch) ? ch : ch ? '#' : null
}

function money(v: number | null, currency: string | null) {
  if (v == null) return null
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency || 'GBP',
      maximumFractionDigits: v < 20 ? 2 : 0,
    }).format(v)
  } catch {
    return `${v}`
  }
}

export function Grid({ records, sortMode, onOpen, onReorder, onDragStateChange }: Props) {
  // The id lives in a ref as well as state: dragover/drop must see it immediately,
  // without waiting for a re-render, while the state drives the dragging style.
  const dragRef = useRef<number | null>(null)
  const [dragId, setDragId] = useState<number | null>(null)
  const [over, setOver] = useState<{ id: number; after: boolean } | null>(null)

  const showLetters = ['smart', 'artist', 'title'].includes(sortMode)

  function handleDrop(target: RecordSummary, after: boolean) {
    setOver(null)
    const dragging = dragRef.current
    if (dragging == null || dragging === target.instanceId) return
    const from = records.findIndex((r) => r.instanceId === dragging)
    if (from < 0) return
    const next = [...records]
    const [moved] = next.splice(from, 1)
    let to = next.findIndex((r) => r.instanceId === target.instanceId)
    if (to < 0) return
    next.splice(after ? to + 1 : to, 0, moved)
    onReorder(next)
  }

  let lastLetter: string | null = null

  return (
    <div className="grid">
      {records.map((r) => {
        const letter = showLetters ? letterFor(r, sortMode) : null
        const showBreak = letter !== null && letter !== lastLetter
        if (letter !== null) lastLetter = letter
        const price = money(r.lowestPrice, r.currency)

        return (
          <Fragment key={r.instanceId}>
            {showBreak && (
              <div className="letter-break">
                <span>{letter}</span>
                <i />
              </div>
            )}
            <div
              className={[
                'card',
                dragId === r.instanceId ? 'dragging' : '',
                over?.id === r.instanceId ? (over.after ? 'drop-after' : 'drop-before') : '',
              ]
                .filter(Boolean)
                .join(' ')}
              draggable
              onDragStart={(e) => {
                dragRef.current = r.instanceId
                setDragId(r.instanceId)
                onDragStateChange(r)
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(r.instanceId))
              }}
              onDragEnd={() => {
                dragRef.current = null
                setDragId(null)
                setOver(null)
                onDragStateChange(null)
              }}
              onDragOver={(e) => {
                if (dragRef.current == null) return
                e.preventDefault()
                const box = e.currentTarget.getBoundingClientRect()
                setOver({ id: r.instanceId, after: e.clientX > box.left + box.width / 2 })
              }}
              onDragLeave={() => setOver((o) => (o?.id === r.instanceId ? null : o))}
              onDrop={(e) => {
                e.preventDefault()
                handleDrop(r, e.clientX > e.currentTarget.getBoundingClientRect().left + e.currentTarget.getBoundingClientRect().width / 2)
              }}
              onClick={() => onOpen(r)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onOpen(r)
                }
              }}
            >
              {/* Thumbs, not covers: the tile is ~185px and the full art is 600px /
                  200KB a piece, which is 600 needless megabytes over a phone link. */}
              <Sleeve src={r.thumb || r.cover} title={r.title} artist={r.artistName} />
              <div className="card-meta">
                <div className="card-title">{r.title}</div>
                <div className="card-artist">{r.artist}</div>
                <div className="card-sub">
                  {(r.originalYear || r.year) && <span>{r.originalYear || r.year}</span>}
                  {r.formatShort && <span>{r.formatShort}</span>}
                  {price && <span className="card-price">{price}</span>}
                </div>
              </div>
            </div>
          </Fragment>
        )
      })}
    </div>
  )
}
