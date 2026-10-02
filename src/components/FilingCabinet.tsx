import { useEffect, useState } from 'react'
import { api } from '../api'
import type { ArtistGuess } from '../types'

const BASIS_LABEL: Record<string, string> = {
  override: 'your rule',
  discogs: 'from Discogs',
  guess: 'best guess',
  plain: 'as written',
}

/**
 * Every artist and the name they file under, so guesses can be audited in one pass
 * rather than one record at a time.
 */
export function FilingCabinet({ onChanged }: { onChanged: () => void }) {
  const [artists, setArtists] = useState<ArtistGuess[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [onlyGuesses, setOnlyGuesses] = useState(false)

  const load = () => api.guesses().then((r) => setArtists(r.artists))
  useEffect(() => {
    load()
  }, [])

  const shown = onlyGuesses ? artists.filter((a) => a.basis === 'guess') : artists
  const guessCount = artists.filter((a) => a.basis === 'guess').length

  async function save(a: ArtistGuess, value: string) {
    const next = value.trim()
    await api.setSortName(a.artistKey, next && next !== a.sortName ? next : null)
    setEditing(null)
    await load()
    onChanged()
  }

  return (
    <div className="cabinet">
      <p className="cabinet-intro">
        People file under surname, groups file under their name with any leading “The” moved to the
        end. Where Discogs knows whether an artist is a person or a band, that is used directly;
        otherwise the shape of the name is used as a guess. Correct anything that looks wrong — the
        change applies to every record by that artist.
      </p>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <button
          className={`btn btn-sm ${onlyGuesses ? '' : 'btn-ghost'}`}
          onClick={() => setOnlyGuesses((v) => !v)}
        >
          Only guesses ({guessCount})
        </button>
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{artists.length} artists</span>
      </div>

      <div className="filing-table">
        <div className="filing-row head">
          <span>Artist</span>
          <span>Filed as</span>
          <span>Source</span>
          <span>Records</span>
        </div>
        {shown.map((a) => (
          <div className="filing-row" key={a.artistKey}>
            <span>{a.artist}</span>
            {editing === a.artistKey ? (
              <input
                autoFocus
                defaultValue={a.sortName}
                onBlur={(e) => save(a, e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setEditing(null)
                }}
              />
            ) : (
              <button
                className="filed-as"
                style={{ textAlign: 'left' }}
                onClick={() => setEditing(a.artistKey)}
                title="Click to change"
              >
                {a.sortName}
              </button>
            )}
            <span className={`chip-basis ${a.basis}`} style={{ justifySelf: 'start' }}>
              {BASIS_LABEL[a.basis]}
            </span>
            <span className="count">{a.count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
