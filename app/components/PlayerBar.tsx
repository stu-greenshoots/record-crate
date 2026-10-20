import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { next, previous, stop, toggle, useSpotify } from '../spotify'
import { go } from '../route'
import { Sleeve } from './Sleeve'
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from './Icons'

// How far a swipe has to go, or how fast, to put the bar away.
const AWAY = 90
const FLICK = 0.6

/**
 * What's playing, above the tabs on every page: so the app works as a music player
 * while you look round the collection. Tap it to go back to the record; swipe it away
 * to stop the music.
 */
export function PlayerBar() {
  const { now } = useSpotify()
  const [dx, setDx] = useState(0)
  const [leaving, setLeaving] = useState(0)
  const drag = useRef<{ x: number; y: number; t: number; moved: boolean } | null>(null)
  const swallow = useRef(false)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!now || now.paused) return
    const t = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [now])
  // The pages make room for the bar while it's there.
  useEffect(() => {
    document.documentElement.classList.toggle('playing', Boolean(now))
  }, [now])
  // A new record playing brings the bar back in place.
  useEffect(() => {
    setDx(0)
    setLeaving(0)
  }, [now?.recId])
  if (!now) return null

  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, moved: false }
  }
  const onMove = (e: PointerEvent) => {
    const d = drag.current
    if (!d) return
    const x = e.clientX - d.x
    if (!d.moved && Math.abs(x) > 8 && Math.abs(x) > Math.abs(e.clientY - d.y)) {
      d.moved = true
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    }
    if (d.moved) setDx(x)
  }
  const onUp = (e: PointerEvent) => {
    const d = drag.current
    drag.current = null
    if (!d?.moved) return
    swallow.current = true
    const speed = Math.abs(dx) / Math.max(1, e.timeStamp - d.t)
    if (Math.abs(dx) > AWAY || speed > FLICK) {
      setLeaving(Math.sign(dx) || 1)
      setTimeout(stop, 200)
    } else setDx(0)
  }

  const track = now.sides[now.face]?.tracks[now.track]
  const at = now.position + (now.paused ? 0 : Date.now() - now.at)
  const done = now.duration ? Math.min(1, at / now.duration) : 0
  return (
    <div
      className={`player-bar ${drag.current?.moved ? 'dragging' : ''}`}
      role="region"
      aria-label="Now playing. Swipe away, or press Escape, to stop"
      style={{
        transform: `translateX(${leaving ? leaving * 110 : (dx / window.innerWidth) * 100}%)`,
        opacity: leaving ? 0 : 1 - Math.min(0.6, Math.abs(dx) / 300),
      }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onClickCapture={(e) => {
        if (swallow.current) {
          swallow.current = false
          e.stopPropagation()
          e.preventDefault()
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') stop()
      }}
    >
      <span className="player-progress" style={{ width: `${done * 100}%` }} aria-hidden />
      <button type="button" className="player-what" onClick={() => go(now.route)}>
        <Sleeve rec={now.rec} className="player-sleeve" />
        <span className="player-text">
          <span className="player-track">{track?.title || now.rec.title}</span>
          <span className="player-album">
            {now.rec.artist} · Side {now.sides[now.face]?.side}
          </span>
        </span>
      </button>
      <button type="button" className="player-btn" aria-label="Previous track" onClick={previous}>
        <PrevIcon />
      </button>
      <button type="button" className="player-btn main" aria-label={now.paused ? 'Play' : 'Pause'} onClick={toggle}>
        {now.paused ? <PlayIcon /> : <PauseIcon />}
      </button>
      <button type="button" className="player-btn" aria-label="Next track" onClick={next}>
        <NextIcon />
      </button>
    </div>
  )
}
