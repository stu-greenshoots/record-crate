import { useEffect, useState } from 'react'
import { next, previous, toggle, useSpotify } from '../spotify'
import { go } from '../route'
import { Sleeve } from './Sleeve'
import { NextIcon, PauseIcon, PlayIcon, PrevIcon } from './Icons'

/**
 * What's playing, above the tabs on every page: so the app works as a music player
 * while you look round the collection. Tap it to go back to the record.
 */
export function PlayerBar() {
  const { now } = useSpotify()
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
  if (!now) return null

  const track = now.sides[now.face]?.tracks[now.track]
  const at = now.position + (now.paused ? 0 : Date.now() - now.at)
  const done = now.duration ? Math.min(1, at / now.duration) : 0
  return (
    <div className="player-bar" role="region" aria-label="Now playing">
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
