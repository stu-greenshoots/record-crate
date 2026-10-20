import { useEffect, useState } from 'react'
import { drop, filled, sidesOf, useSpotify, wake } from '../spotify'
import type { Rec, Side } from '../types'
import { toast } from './Toast'

const time = (s: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : '')

/** The record's tracks, side by side. Tap one to play it from the top; the one playing is lit. */
export function Tracks({ rec, route }: { rec: Rec; route?: string }) {
  const spotify = useSpotify()
  const [sides, setSides] = useState<Side[] | null>(null)
  useEffect(() => {
    let live = true
    setSides(null)
    sidesOf(rec).then((s) => live && setSides(s))
    return () => {
      live = false
    }
  }, [rec])
  if (!sides?.some((s) => s.tracks.length)) return null
  // Spotify's lengths, once the album has been found, where Discogs has none.
  const shown = filled(rec, sides)
  const now = spotify.now?.recId === rec.id ? spotify.now : null

  const play = (face: number, track: number) => {
    // Before anything is awaited: iOS only starts audio inside the touch.
    wake()
    drop(rec, face, sides, () => ({ track, offset: 0 }), route).then((why) => why && toast(why))
  }

  return (
    <section className="tracks">
      <h3 className="section-title">Tracks</h3>
      {shown.map((side, face) =>
        side.tracks.length ? (
          <div key={side.side} className="tracks-side">
            <h4 className="tracks-side-name">Side {side.side}</h4>
            <ol>
              {side.tracks.map((t, i) => {
                const on = now?.face === face && now.track === i
                return (
                  <li key={`${t.position}-${i}`} className={on ? 'on' : ''}>
                    <button
                      type="button"
                      className="track"
                      aria-current={on ? 'true' : undefined}
                      aria-label={`${on && !now?.paused ? 'Playing' : 'Play'} ${t.title}`}
                      onClick={() => play(face, i)}
                    >
                      <span className="track-mark" aria-hidden>
                        {on ? <span className={`bars ${now?.paused ? 'still' : ''}`}><i /><i /><i /></span> : '▶'}
                      </span>
                      <span className="track-pos">{t.position}</span>
                      <span className="track-title">{t.title}</span>
                      <span className="track-time">{time(t.seconds)}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </div>
        ) : null,
      )}
    </section>
  )
}
