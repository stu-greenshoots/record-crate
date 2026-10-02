import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { RecordSummary } from '../types'
import { img } from '../api'
import { BlankSleeve } from './Sleeve'

interface Props {
  records: RecordSummary[]
  index: number
  onIndex: (i: number) => void
  onOpen: (r: RecordSummary) => void
  sortMode: string
}

const VISIBLE = 7
const SIZE = 340
const SPACING = 86
const GAP = 148
const DEPTH = 130
const ANGLE = 52

/** Everything in the scene is sized off the sleeve, so one factor scales the lot. */
function useStageScale() {
  const [width, setWidth] = useState(() => (typeof window === 'undefined' ? 1200 : window.innerWidth))
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const size = Math.max(150, Math.min(SIZE, width * (width < 900 ? 0.56 : 0.3)))
  return { size, scale: size / SIZE, narrow: width < 900 }
}

const LETTERS = '#ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

function letterFor(r: RecordSummary, mode: string) {
  const source = mode === 'artist' ? r.artist : mode === 'title' ? r.title : r.sortName
  const ch = source?.trim()[0]?.toUpperCase() ?? ''
  return /[A-Z]/.test(ch) ? ch : '#'
}

/**
 * Coverflow-style crate you flick through with the arrow keys, a scroll, or a drag.
 * Records to either side lean away toward the centre, exactly like leafing through
 * a full crate in a shop.
 */
export function Crate({ records, index, onIndex, onOpen, sortMode }: Props) {
  const stage = useRef<HTMLDivElement>(null)
  const { size, scale, narrow } = useStageScale()
  const wheelAcc = useRef(0)
  const wheelLock = useRef(false)
  const drag = useRef<{ x: number; startIndex: number } | null>(null)

  const clamp = useCallback(
    (i: number) => Math.max(0, Math.min(records.length - 1, i)),
    [records.length],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        onIndex(clamp(index - 1))
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        onIndex(clamp(index + 1))
      } else if (e.key === 'Home') {
        onIndex(0)
      } else if (e.key === 'End') {
        onIndex(records.length - 1)
      } else if (e.key === 'Enter' && records[index]) {
        onOpen(records[index])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, records, clamp, onIndex, onOpen])

  // Wheel and trackpad flicks, throttled to one record per gesture step.
  useEffect(() => {
    const el = stage.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      if (wheelLock.current) return
      wheelAcc.current += Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      if (Math.abs(wheelAcc.current) > 42) {
        onIndex(clamp(index + Math.sign(wheelAcc.current)))
        wheelAcc.current = 0
        wheelLock.current = true
        setTimeout(() => (wheelLock.current = false), 110)
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [index, clamp, onIndex])

  const rail = useMemo(() => {
    const first = new Map<string, number>()
    records.forEach((r, i) => {
      const l = letterFor(r, sortMode)
      if (!first.has(l)) first.set(l, i)
    })
    return first
  }, [records, sortMode])

  const current = records[index]
  const currentLetter = current ? letterFor(current, sortMode) : null

  if (!records.length) return null

  return (
    <div className="crate">
      <div
        className="crate-stage"
        ref={stage}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, startIndex: index }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const delta = Math.round((drag.current.x - e.clientX) / (narrow ? 42 : 62))
          const next = clamp(drag.current.startIndex + delta)
          if (next !== index) onIndex(next)
        }}
        onPointerUp={(e) => {
          drag.current = null
          e.currentTarget.releasePointerCapture(e.pointerId)
        }}
        onPointerCancel={() => (drag.current = null)}
      >
        {records.map((r, i) => {
          const offset = i - index
          if (Math.abs(offset) > VISIBLE) return null
          const dir = Math.sign(offset)
          const x = (offset * SPACING + dir * GAP * 0.55) * scale
          const z = (offset === 0 ? 90 : -Math.abs(offset) * DEPTH - 70) * scale
          const rotate = -dir * ANGLE
          const opacity = Math.abs(offset) >= VISIBLE ? 0 : 1 - Math.abs(offset) * 0.055

          return (
            <div
              key={r.instanceId}
              className="crate-item"
              style={{
                width: size,
                height: size,
                marginTop: -size * 0.7,
                marginLeft: -size * 0.5,
                transform: `translate3d(${x}px, 0, ${z}px) rotateY(${rotate}deg) scale(${offset === 0 ? 1 : 0.95})`,
                zIndex: 100 - Math.abs(offset),
                opacity,
              }}
              onClick={() => (offset === 0 ? onOpen(r) : onIndex(i))}
            >
              <div className="sleeve-art" style={{ position: 'absolute', inset: 0 }}>
                {r.cover ? (
                  <img src={img(r.cover)} alt="" draggable={false} loading="lazy" />
                ) : (
                  <BlankSleeve title={r.title} artist={r.artistName} />
                )}
              </div>
              {r.cover && (
                <div className="reflection">
                  <img src={img(r.cover)} alt="" draggable={false} loading="lazy" />
                </div>
              )}
            </div>
          )
        })}

        <div className="crate-hint">
          <span>
            <kbd>←</kbd> <kbd>→</kbd> flick
          </span>
          <span>
            <kbd>↵</kbd> open
          </span>
          <span>
            {index + 1} of {records.length}
          </span>
        </div>
      </div>

      <div className="crate-caption">
        {current && (
          <>
            <h3>{current.title}</h3>
            <div className="artist">{current.artist}</div>
            <div className="meta">
              {(current.originalYear || current.year) && <span>{current.originalYear || current.year}</span>}
              {current.label && <span>{current.label}</span>}
              {current.catno && <span>{current.catno}</span>}
              {current.formatShort && <span>{current.formatShort}</span>}
            </div>
            <div className="filed">filed under “{current.sortName}”</div>
          </>
        )}
      </div>

      <div className="crate-rail">
        {LETTERS.map((l) => {
          const target = rail.get(l)
          return (
            <button
              key={l}
              className={currentLetter === l ? 'on' : ''}
              disabled={target === undefined}
              style={target === undefined ? { opacity: 0.22, cursor: 'default' } : undefined}
              onClick={() => target !== undefined && onIndex(target)}
            >
              {l}
            </button>
          )
        })}
      </div>
    </div>
  )
}
