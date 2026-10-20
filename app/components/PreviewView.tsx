import { useEffect, useState } from 'react'
import { loadPreview, type Preview } from '../preview'
import { useStore } from '../store'
import { back } from '../route'
import { yearOf } from '../where'
import { Deck, FitTitle } from './TurntableView'
import { Tracks } from './Tracks'
import { BackIcon } from './Icons'

/**
 * An album you don't own, on the turntable for a listen before buying: its tracks from
 * MusicBrainz, played through Spotify like any record of yours.
 */
export function PreviewView({ id }: { id: string }) {
  const store = useStore()
  const [preview, setPreview] = useState<Preview | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    setPreview(null)
    setError(null)
    loadPreview(id)
      .then((p) => live && setPreview(p))
      .catch((e) => live && setError(String(e.message || e)))
    return () => {
      live = false
    }
  }, [id])
  if (!store) return null
  const rec = preview?.rec ?? null

  return (
    <div className="deck tall preview">
      <div className="deck-screen">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => back('')} aria-label="Back">
            <BackIcon />
          </button>
        </header>
        <div className="about">
          {rec ? (
            <>
              <div className="eyebrow-row">
                <p className="eyebrow">
                  {rec.artist}
                  {yearOf(rec) ? ` · ${yearOf(rec)}` : ''}
                </p>
                <p className="press-badge">Not yours yet</p>
              </div>
              <FitTitle text={rec.title} />
              <p className="where-words">
                A listen before you buy. Touch the grooves or pick a track to play it.
                {preview?.masterId ? (
                  <>
                    {' '}
                    <a href={`https://www.discogs.com/master/${preview.masterId}`} target="_blank" rel="noreferrer">
                      Find a copy on Discogs ↗
                    </a>
                  </>
                ) : null}
              </p>
            </>
          ) : (
            <p className="hint-note">{error ? `Couldn't get this album: ${error}` : 'Asking MusicBrainz…'}</p>
          )}
        </div>
        {rec && <Deck store={store} rec={rec} order={[rec.id]} wide={false} route={`preview/${id}`} />}
      </div>
      {rec && (
        <div className="deck-details">
          <section className="record-extra">
            <Tracks rec={rec} route={`preview/${id}`} />
          </section>
        </div>
      )}
    </div>
  )
}
