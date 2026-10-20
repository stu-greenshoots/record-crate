import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import { noteLookup, putBack, takeOut, useStore } from '../store'
import type { Derived } from '../store'
import { go } from '../route'
import { warmUp } from '../recognise'
import { alongWords, cubePlace, fractionAlong, yearOf } from '../where'
import type { BuiltMap, Face, Rec, Side } from '../types'
import { grooves, radiusAt, timeAt } from '../../shared/needle.js'
import { drop as dropNeedle, filled, lift, sidesOf, stop, useSpotify, wake } from '../spotify'
import { Sleeve } from './Sleeve'
import { RecordLabel } from './Label'
import { SearchPanel } from './SearchPanel'
import { RecordDetails } from './RecordDetails'
import { pressBadge } from './Pressing'
import { CameraIcon, CheckIcon, DiceIcon, ReturnIcon, SearchIcon } from './Icons'
import { RandomBar, RandomSheet, pickRandom } from './Random'
import { toast } from './Toast'

/**
 * The home screen: a turntable. The record you're holding spins on the platter, and
 * the records either side of it on the shelf stand round it in a ring. Spin the ring
 * to walk along the shelf; where it goes is written above. With nothing on the
 * platter the ring holds the records you looked up last.
 *
 * On a phone the platter rises from the bottom and the ring arcs over it. On a
 * landscape tablet the platter sits left, the ring curls round its right side and the
 * details have a column of their own.
 */

/** How far either side of the platter sleeves are drawn. */
const SHOWN = 3
/** The most records one flick moves. */
const FLING = 6

/** A record moved onto the platter by spinning, not looked up: kept out of "recent". */
let spunTo: number | null = null

export function TurntableView({ id }: { id: number | null }) {
  const store = useStore()
  const wide = useWide()
  const [searching, setSearching] = useState(false)
  const [randomOpen, setRandomOpen] = useState(false)

  useEffect(() => {
    if (id == null) return
    if (spunTo === id) spunTo = null
    else noteLookup(id)
  }, [id])

  const order = useMemo(() => (store ? store.built.slots.flatMap((c) => c.instanceIds) : []), [store?.built])
  if (!store) return <div className="page loading"><span className="spinner-disc" /></div>

  const rec = id != null ? store.byId.get(id) || null : null
  const pick = (r: Rec) => {
    setSearching(false)
    go(`r/${r.id}`)
  }

  const head = (
    <header className="deck-head">
      <span className="brand-name">Record Crate</span>
      {store.out.length > 0 && (
        <button type="button" className="pill pill-oxblood" onClick={() => go('out')}>
          {store.out.length} out
        </button>
      )}
      <button
        type="button"
        className="round-btn"
        aria-label="Pick a random record"
        onClick={() => pickRandom(store, rec?.id ?? null) || setRandomOpen(true)}
      >
        <DiceIcon />
      </button>
      {!wide && (
        <button type="button" className="round-btn" aria-label="Find a record" onClick={() => setSearching(true)}>
          <SearchIcon />
        </button>
      )}
    </header>
  )
  const about = rec ? (
    <About store={store} rec={rec} wide={wide} onRandom={() => setRandomOpen(true)} />
  ) : id != null ? (
    <p className="empty-note">That record isn't in the collection any more.</p>
  ) : (
    <Welcome store={store} />
  )
  const deck = <Deck store={store} rec={rec} order={order} wide={wide} />

  if (wide) {
    return (
      <div className="deck wide">
        {head}
        {deck}
        <aside className="deck-side" aria-label="This record">
          <SearchPanel onPick={pick} />
          {about}
          {rec && <RecordDetails rec={rec} />}
        </aside>
        {randomOpen && <RandomSheet store={store} current={rec?.id ?? null} onClose={() => setRandomOpen(false)} />}
      </div>
    )
  }
  return (
    <div className="deck tall">
      <div className="deck-screen">
        {head}
        {about}
        {deck}
      </div>
      {rec && (
        <div id="record-details" className="deck-details">
          <RecordDetails rec={rec} />
        </div>
      )}
      {searching && (
        <div className="search-sheet" role="dialog" aria-label="Find a record">
          <SearchPanel autoFocus onPick={pick} onClose={() => setSearching(false)} />
        </div>
      )}
      {randomOpen && <RandomSheet store={store} current={rec?.id ?? null} onClose={() => setRandomOpen(false)} />}
    </div>
  )
}

function useWide() {
  const query = '(min-width: 900px) and (orientation: landscape)'
  const [wide, setWide] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const m = matchMedia(query)
    const on = () => setWide(m.matches)
    m.addEventListener('change', on)
    return () => m.removeEventListener('change', on)
  }, [])
  return wide
}

/* ------------------------------------------------------------------ */
/* The platter and the ring                                            */
/* ------------------------------------------------------------------ */

interface Geometry {
  /** Platter diameter and centre, in the stage's own pixels. */
  d: number
  cx: number
  cy: number
  /** Sleeve size and ring radius, for the one by the platter and the rest. */
  s0: number
  s: number
  r0: number
  r: number
  /** Where the ring starts, and degrees between neighbours. */
  base: number
  step: number
}

function geometry(w: number, h: number, wide: boolean): Geometry {
  if (wide) {
    const d = Math.min(h * 0.56, w * 0.5)
    const s0 = d * 0.5
    return { d, cx: w * 0.36, cy: h * 0.5, s0, s: s0 * 0.64, r0: d * 0.98, r: d * 0.93, base: 0, step: 21 }
  }
  let s0 = Math.min(w * 0.44, 190)
  // The platter shows mostly above the bottom edge, its label whole; the ring has to
  // clear it and still fit under the top of the stage.
  let d = Math.min(w * 1.02, 460, (h - s0 - 26) / 0.76)
  if (d < 260) {
    s0 *= Math.max(0.7, d / 260)
    d = Math.min(w * 1.02, (h - s0 - 26) / 0.76)
  }
  const cy = h - d * 0.26
  const r0 = d / 2 + s0 / 2 + 14
  return { d, cx: w / 2, cy, s0, s: s0 * 0.6, r0, r: r0 - 8, base: -90, step: 23 }
}

function Deck({ store, rec, order, wide }: { store: Derived; rec: Rec | null; order: number[]; wide: boolean }) {
  const stage = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [drag, setDrag] = useState(0)
  const [homeAt, setHomeAt] = useState(0)
  const gesture = useRef<{ start: number; last: number; t: number; v: number; moved: boolean } | null>(null)
  const swallowClick = useRef(false)

  // A record put on by search or the camera is lowered onto the platter; one reached
  // by spinning the ring just swaps its label, or a fast spin would keep re-dropping.
  const seen = useRef<{ id: number | null; drop: number }>({ id: null, drop: 0 })
  const id = rec?.id ?? null
  if (id !== seen.current.id) {
    if (spunTo !== id) seen.current.drop++
    seen.current.id = id
  }
  const drop = seen.current.drop

  // Which side is up. Tapping the label turns the record over; on a set, the side after
  // B is the next record's A side (C), and so on round.
  const faces = useMemo(() => facesOf(rec), [rec])
  const [up, setUp] = useState<{ id: number | null; i: number }>({ id: null, i: 0 })
  const face = up.id === id ? up.i % faces.length : 0
  const discEl = useRef<HTMLDivElement>(null)
  const turning = useRef(false)
  // What's on each side, for where a touch on the grooves lands.
  const [sides, setSides] = useState<{ id: number; sides: Side[] } | null>(null)
  useEffect(() => {
    if (!rec) return
    let live = true
    sidesOf(rec).then((s) => live && setSides({ id: rec.id, sides: s }))
    return () => {
      live = false
    }
  }, [rec])
  const spotify = useSpotify()
  const now = spotify.now
  // Spotify's track lengths, once the album has been found, where Discogs has none.
  const known = useMemo(
    () => (rec && sides?.id === rec.id ? filled(rec, sides.sides) : undefined),
    // `now` changes once the album has been found and played.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rec, sides, now?.recId],
  )
  const side = known?.[face]
  const span = grooves(rec?.inches)

  // The needle: down where Spotify says it is, creeping in as the side plays.
  const needleHere = rec && now && now.recId === rec.id && now.face === face && now.track >= 0 && side ? now : null
  const [, tick] = useState(0)
  useEffect(() => {
    if (!needleHere || needleHere.paused) return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [needleHere])
  // A track played from the list on the other side: turn the record over to it.
  useEffect(() => {
    if (now && now.recId === id && now.face !== face) setUp({ id, i: now.face })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now?.recId, now?.face])
  // Another record on the platter takes the needle off the last one.
  useEffect(() => {
    if (now && now.recId !== id) stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  const onGroove = (e: React.MouseEvent) => {
    if (!rec || (e.target as HTMLElement).closest('.label-hit')) return
    const box = stage.current!.getBoundingClientRect()
    const d = (g.d * (rec.inches || 12)) / 12
    const r = Math.hypot(e.clientX - box.left - g.cx, e.clientY - box.top - g.cy) / (d / 2)
    if (!side || r < span.inner) return
    // Before anything is awaited: iOS only starts audio inside the touch.
    wake()
    dropNeedle(rec, face, sides!.sides, (s) => timeAt(r, s, span)).then((why) => why && toast(why))
  }

  const turnOver = () => {
    if (turning.current || faces.length < 2) return
    if (now?.recId === id) stop()
    const next = (face + 1) % faces.length
    const el = discEl.current
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Onto the next record of a set: that one is lowered on, like any record.
    if (Math.floor(next / 2) !== Math.floor(face / 2) || still || !el?.animate) return setUp({ id, i: next })
    turning.current = true
    // Lift it and turn it edge on, swap the side, and turn it back down.
    const lift = el.animate([{ rotate: 'y 0deg', translate: '0 0' }, { rotate: 'y 90deg', translate: '0 -14px' }], {
      duration: 260,
      easing: 'ease-in',
      fill: 'forwards',
    })
    lift.finished
      .then(() => {
        setUp({ id, i: next })
        const down = el.animate([{ rotate: 'y -90deg', translate: '0 -14px' }, { rotate: 'y 0deg', translate: '0 0' }], {
          duration: 340,
          easing: 'cubic-bezier(.2,.8,.3,1)',
        })
        lift.cancel()
        return down.finished
      })
      .catch(() => {})
      .finally(() => {
        turning.current = false
      })
  }

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /** The ring: the shelf either side of the record, or with nothing on, the last few looked up. */
  const ring = useMemo(() => {
    if (rec) {
      const at = order.indexOf(rec.id)
      return at >= 0 ? { ids: order, at } : { ids: [rec.id], at: 0 }
    }
    const recent = store.local.recent.filter((x) => store.byId.has(x))
    return { ids: recent.length ? recent : order.slice(0, 12), at: Math.min(homeAt, Math.max(0, (recent.length || 12) - 1)) }
  }, [rec, order, store.local.recent, store.byId, homeAt])

  const g = geometry(size.w, size.h, wide)
  const stepPx = (g.r * g.step * Math.PI) / 180

  const moveTo = (n: number) => {
    const i = Math.max(0, Math.min(ring.ids.length - 1, n))
    if (i === ring.at) return
    if (!rec) return setHomeAt(i)
    spunTo = ring.ids[i]
    go(`r/${ring.ids[i]}`, true)
  }

  const coord = (e: ReactPointerEvent) => (wide ? e.clientY : e.clientX)
  const onDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return
    gesture.current = { start: coord(e), last: coord(e), t: e.timeStamp, v: 0, moved: false }
  }
  const onMove = (e: ReactPointerEvent) => {
    const gs = gesture.current
    if (!gs) return
    const p = coord(e)
    const dt = Math.max(1, e.timeStamp - gs.t)
    gs.v = 0.8 * ((p - gs.last) / dt) + 0.2 * gs.v
    gs.last = p
    gs.t = e.timeStamp
    if (!gs.moved && Math.abs(p - gs.start) > 8) {
      gs.moved = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    if (gs.moved) setDrag(-(p - gs.start) / stepPx)
  }
  const onUp = () => {
    const gs = gesture.current
    gesture.current = null
    if (!gs?.moved) return
    swallowClick.current = true
    // Carry on in the direction of the flick, as a platter would.
    const fling = (-gs.v * 260) / stepPx
    const shift = Math.max(-FLING, Math.min(FLING, Math.round(drag + fling)))
    setDrag(0)
    moveTo(ring.at + shift)
  }

  const at = ring.at + drag
  const shown = ring.ids
    .map((rid, k) => ({ rid, k, off: k - at }))
    // Sleeves a flick can bring into view stay mounted, unseen, so they come round
    // the ring from where they really are rather than appearing in place.
    .filter(({ off }) => Math.abs(off) <= SHOWN + FLING + 1)

  const spot = rec ? store.spots.get(rec.id) : null
  // The arm tracks the needle across the record as you walk along the cube.
  const arm = rec ? 16 + (spot ? fractionAlong(spot, store.byId) : 0.5) * 16 : -6

  return (
    <section
      className={`stage ${drag ? 'dragging' : ''}`}
      ref={stage}
      aria-label="Turntable"
      tabIndex={0}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClickCapture={(e) => {
        if (swallowClick.current) {
          swallowClick.current = false
          e.stopPropagation()
          e.preventDefault()
        }
      }}
      onKeyDown={(e) => {
        const next = wide ? ['ArrowDown', 'ArrowRight'] : ['ArrowRight', 'ArrowDown']
        const prev = wide ? ['ArrowUp', 'ArrowLeft'] : ['ArrowLeft', 'ArrowUp']
        if (next.includes(e.key)) moveTo(ring.at + 1)
        else if (prev.includes(e.key)) moveTo(ring.at - 1)
        else return
        e.preventDefault()
      }}
    >
      {size.w > 0 && (
        <>
          <span className="ripple" aria-hidden style={{ left: g.cx, top: g.cy, width: g.d * 2.2, height: g.d * 2.2 }} />
          {wide && (
            <span
              className="plinth"
              aria-hidden
              style={{ left: g.cx - g.d * 0.64, top: g.cy - g.d * 0.64, width: g.d * 1.28, height: g.d * 1.28 }}
            />
          )}
          <span className="platter" aria-hidden style={{ left: g.cx - g.d / 2 - 10, top: g.cy - g.d / 2 - 10, width: g.d + 20, height: g.d + 20 }} />
          <div
            key={rec ? `on-${drop}-${Math.floor(face / 2)}` : 'empty'}
            ref={discEl}
            className={`disc ${rec ? 'on' : 'empty'}`}
            style={discStyle(g, rec?.inches)}
            onClick={onGroove}
          >
            {side && !faces[face].disc && !faces[face].under && <Bands side={side} span={span} />}
            {rec ? <RecordLabel key={`${rec.id}-${face}`} rec={rec} face={faces[face]} /> : <span className="disc-label blank" />}
            {rec && faces.length > 1 && (
              <button
                type="button"
                className="label-hit"
                aria-label={`Side ${faces[face].side} is up. ${
                  Math.floor(((face + 1) % faces.length) / 2) === Math.floor(face / 2) ? 'Turn it over to' : 'Put on'
                } side ${faces[(face + 1) % faces.length].side}`}
                onClick={turnOver}
              />
            )}
          </div>
          <span className="spindle" aria-hidden style={{ left: g.cx, top: g.cy }} />
          {needleHere && side && rec && (
            <Needle
              x={g.cx}
              y={g.cy}
              r={
                radiusAt(
                  needleHere.track,
                  (needleHere.position + (needleHere.paused ? 0 : Date.now() - needleHere.at)) / 1000,
                  side,
                  span,
                ) *
                ((g.d * (rec.inches || 12)) / 24)
              }
              lifted={needleHere.paused}
              title={side.tracks[needleHere.track]?.title}
            />
          )}
          {wide && (
            <span
              className="arm"
              aria-hidden
              style={{ left: g.cx + g.d * 0.5, top: g.cy - g.d * 0.5, height: g.d * 0.8, transform: `rotate(${arm}deg)` }}
            />
          )}

          {shown.map(({ rid, k, off }) => {
            const r = store.byId.get(rid)
            if (!r) return null
            const near = Math.max(0, 1 - Math.abs(off))
            const radius = g.r + (g.r0 - g.r) * near
            const sz = g.s + (g.s0 - g.s) * near
            const a = g.base + off * g.step
            const hidden = Math.abs(off) > SHOWN + 0.2
            const centre = k === ring.at
            return (
              <button
                type="button"
                key={rid}
                className={`orbit ${centre ? 'centre' : ''} ${store.local.out[rid] ? 'is-out' : ''}`}
                style={{
                  width: g.s0,
                  height: g.s0,
                  // Placed by angle and radius from the spindle, so a move animates
                  // round the ring; as x and y it would cut straight across the platter.
                  transform: `translate(${g.cx - g.s0 / 2}px, ${g.cy - g.s0 / 2}px) rotate(${a}deg) translateX(${radius}px) rotate(${-a}deg) scale(${sz / g.s0})`,
                  zIndex: 20 - Math.round(Math.abs(off)),
                  opacity: hidden ? 0 : 1,
                  filter: `brightness(${centre && rec ? 1 : Math.max(0.4, 0.8 - Math.abs(off) * 0.12)})`,
                }}
                tabIndex={-1}
                aria-label={`${r.artist}, ${r.title}`}
                onClick={() => (centre && !rec ? go(`r/${rid}`) : moveTo(k))}
              >
                <Sleeve rec={r} />
              </button>
            )
          })}
        </>
      )}
      {wide && (
        <div className="stage-keys">
          <button type="button" className="round-btn" aria-label="Previous record" onClick={() => moveTo(ring.at - 1)}>
            <Chevron up />
          </button>
          <button type="button" className="round-btn" aria-label="Next record" onClick={() => moveTo(ring.at + 1)}>
            <Chevron />
          </button>
          <span>or spin the ring</span>
        </div>
      )}
    </section>
  )
}

const Chevron = ({ up = false }: { up?: boolean }) => (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
    <path d={up ? 'M5 15l7-7 7 7' : 'M5 9l7 7 7-7'} />
  </svg>
)

/* ------------------------------------------------------------------ */
/* What's on the platter, and where it goes                            */
/* ------------------------------------------------------------------ */

function About({ store, rec, wide, onRandom }: { store: Derived; rec: Rec; wide: boolean; onRandom: () => void }) {
  const spot = store.spots.get(rec.id)
  const isOut = Boolean(store.local.out[rec.id])
  const shelfName = store.shelves.find((s) => s.id === rec.shelf)?.name || rec.shelf

  const onPrimary = () => {
    if (isOut) {
      putBack(rec.id)
      toast(`${rec.title} is back on the shelf`, { undo: () => takeOut(rec.id) })
    } else {
      takeOut(rec.id)
      toast(`Out of the shelf — it'll wait in Put back`, { undo: () => putBack(rec.id) })
    }
  }

  return (
    <div className="about">
      <p className="eyebrow">
        {rec.artistId ? (
          <button type="button" className="artist-link" onClick={() => go(`artist/${rec.artistId}`)}>
            {rec.artist}
          </button>
        ) : (
          rec.artist
        )}
        {!wide && yearOf(rec) ? ` · ${yearOf(rec)}` : ''}
      </p>
      <h1 className="about-title">{rec.title}</h1>
      {pressBadge(rec) && <p className="press-badge">{pressBadge(rec)}</p>}
      <RandomBar store={store} rec={rec} onChange={onRandom} />
      {wide && <p className="about-meta">{[yearOf(rec), rec.format, rec.catno].filter(Boolean).join(' · ')}</p>}

      {spot ? (
        <div className="about-where">
          {wide && (
            <div className="where-head">
              <h2 className="where-label">{spot.cube.label}</h2>
              <p className="where-place">{cubePlace(spot.cube, store.built)}</p>
            </div>
          )}
          <MiniUnit built={store.built} target={spot.cube.index} wide={wide} />
          <p className="where-words">
            {!wide && (
              <>
                <strong>
                  {spot.cube.label}, {cubePlace(spot.cube, store.built).toLowerCase()}.
                </strong>{' '}
              </>
            )}
            {isOut ? 'Goes back ' : ''}
            {spot.index + 1} of {spot.cube.count}, {alongWords(fractionAlong(spot, store.byId), spot.cube.count)}
            {spot.before || spot.after ? ', ' : '.'}
            <Between spot={spot} />
          </p>
        </div>
      ) : (
        <p className="empty-note">This shelf ({shelfName}) isn't on the unit. Give it a cube in Unit → Settings.</p>
      )}

      <div className="about-actions">
        <button type="button" className={`btn btn-big ${isOut ? 'btn-primary' : 'btn-mustard'}`} onClick={onPrimary}>
          {isOut ? <CheckIcon /> : <ReturnIcon />}
          {isOut ? 'Put it back' : 'Take it out'}
        </button>
        {!wide && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => document.getElementById('record-details')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          >
            More
          </button>
        )}
      </div>
    </div>
  )
}

function Between({ spot }: { spot: NonNullable<ReturnType<Derived['spots']['get']>> }) {
  const { before, after } = spot
  if (before && after)
    return (
      <>
        between <b>{before.title}</b> and <b>{after.title}</b>.
      </>
    )
  if (before)
    return (
      <>
        after <b>{before.title}</b>.
      </>
    )
  if (after)
    return (
      <>
        before <b>{after.title}</b>.
      </>
    )
  return null
}

/** The unit in pine, small, with the record's cube glowing. */
function MiniUnit({ built, target, wide }: { built: BuiltMap; target: number; wide: boolean }) {
  return (
    <button
      type="button"
      className={`mini-unit ${wide ? 'big' : ''}`}
      style={{ gridTemplateColumns: `repeat(${built.cols}, minmax(0, 1fr))` }}
      onClick={() => go(`unit/${target}`)}
      aria-label={`Open ${built.slots[target]?.label}, cube by cube`}
    >
      {built.slots.map((c) => (
        <i key={c.index} className={c.index === target ? 'target' : ''} />
      ))}
    </button>
  )
}

function Welcome({ store }: { store: Derived }) {
  const recent = store.local.recent.length > 0
  return (
    <div className="about welcome">
      <p className="eyebrow">{store.records.length} records</p>
      <h1 className="about-title">What are you holding?</h1>
      <p className="welcome-sub">
        {recent
          ? 'The ring holds what you looked up last. Tap one to put it on, or find another.'
          : 'Find a record, or point the camera at its sleeve, and it goes on the platter with where it lives.'}
      </p>
      <button type="button" className="scan-card" onPointerDown={() => warmUp()} onClick={() => go('scan')}>
        <span className="scan-icon">
          <CameraIcon />
        </span>
        <span className="scan-text">
          <strong>Point at a sleeve</strong>
          <span>Find out where it lives</span>
        </span>
      </button>
    </div>
  )
}

/**
 * A 7" or 10" sits on the same 12" platter, smaller, with a label that takes up more
 * of it: about 3½" across on a 7", 4" on a 10" or 12".
 */
function discStyle(g: { cx: number; cy: number; d: number }, inches = 12) {
  const d = (g.d * inches) / 12
  const label = inches <= 7 ? 50 : inches <= 10 ? 40 : 35.7
  return { left: g.cx - d / 2, top: g.cy - d / 2, width: d, height: d, '--label': `${label}%` } as CSSProperties
}

/** The sides to flip through. A record bought since the snapshot has only what the
 * phone knows: one label, maybe, and two sides. */
function facesOf(rec: Rec | null): Face[] {
  if (!rec) return [{ side: 'A' }]
  const faces: Face[] = rec.faces?.length
    ? rec.faces
    : [{ side: 'A', art: rec.labelArt || undefined, disc: rec.labelDisc }, { side: 'B' }]
  // A side with only a label photo, on a coloured or picture disc whose other side was
  // photographed whole, shows that vinyl round its label rather than turning black.
  return faces.map((f, i) => {
    const other = faces[i ^ 1]
    return !f.disc && other?.disc && other.art ? { ...f, under: other.art } : f
  })
}

/** The gaps between tracks, catching the light, on a record drawn rather than photographed. */
function Bands({ side, span }: { side: Side; span: { outer: number; inner: number } }) {
  const rings = side.tracks.slice(1).map((_, i) => radiusAt(i + 1, 0, side, span) * 100)
  const edge = [span.outer * 100, span.inner * 100]
  const ring = (at: number, w: number, a: number) =>
    `radial-gradient(circle closest-side, transparent ${at - w}%, rgba(255,255,255,${a}) ${at - w}%, rgba(255,255,255,${a}) ${at}%, transparent ${at}%)`
  return (
    <span
      className="bands"
      aria-hidden
      style={{ background: [...rings.map((r) => ring(r, 0.9, 0.08)), ...edge.map((r) => ring(r, 0.5, 0.05))].join(', ') }}
    />
  )
}

/** Where the needle is on the record. Tap it to lift it, and again to put it back. */
function Needle({ x, y, r, lifted, title }: { x: number; y: number; r: number; lifted: boolean; title?: string }) {
  // Up and to the right of the spindle, where the arm comes in.
  const a = (-55 * Math.PI) / 180
  return (
    <button
      type="button"
      className={`needle ${lifted ? 'lifted' : ''}`}
      style={{ left: x + r * Math.cos(a), top: y + r * Math.sin(a) }}
      aria-label={lifted ? `Put the needle back down${title ? ` on ${title}` : ''}` : `Lift the needle${title ? `, playing ${title}` : ''}`}
      onClick={lift}
    />
  )
}
