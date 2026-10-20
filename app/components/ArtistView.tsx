import { useEffect, useMemo, useState } from 'react'
import { discography } from '../../shared/discography.js'
import { loadArtist, type ArtistPage } from '../artist'
import { useStore } from '../store'
import { back, go } from '../route'
import { yearOf } from '../where'
import type { Rec } from '../types'
import { Sleeve } from './Sleeve'
import { BackIcon } from './Icons'

type Kind = 'album' | 'live' | 'ep' | 'comp' | 'single' | 'other'
type Show = 'all' | 'yours' | 'missing'

const SECTIONS: [Kind, string][] = [
  ['album', 'Studio albums'],
  ['live', 'Live albums'],
  ['ep', 'EPs'],
  ['comp', 'Compilations'],
  ['single', 'Singles'],
  ['other', 'Other'],
]
const COUNTED: Kind[] = ['album', 'live']

interface Album {
  id: string
  title: string
  year: number | null
  kind: Kind
  masters: number[]
  own: number[]
}

/** An artist's albums: the ones on your shelf, and the ones that aren't. */
export function ArtistView({ discogsId, mbid }: { discogsId?: number; mbid?: string }) {
  const store = useStore()
  const [page, setPage] = useState<ArtistPage | null | undefined>(undefined)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<Show>('all')

  useEffect(() => {
    let live = true
    setPage(undefined)
    setError(null)
    loadArtist(discogsId ? { discogsId } : { mbid })
      .then((p) => live && setPage(p))
      .catch((e) => live && setError(String(e.message || e)))
    return () => {
      live = false
    }
  }, [discogsId, mbid])

  const id = discogsId ?? page?.discogsId ?? null
  const records = useMemo(() => (store && id ? store.records.filter((r) => r.artistId === id) : []), [store, id])
  const disc = useMemo(
    () => (page ? (discography(page.groups, records) as { albums: Album[]; counts: Record<string, { have: number; total: number }>; unmatched: number[] }) : null),
    [page, records],
  )
  if (!store) return null

  const name = page?.name || records[0]?.artist || 'Artist'
  const topbar = (
    <header className="topbar">
      <button type="button" className="icon-btn" onClick={() => back('')} aria-label="Back">
        <BackIcon />
      </button>
    </header>
  )

  if (page === undefined && !error) {
    return (
      <div className="page artist-page">
        {topbar}
        <h1 className="page-title">{name}</h1>
        <p className="hint-note">{mbid ? 'Asking MusicBrainz…' : 'Loading…'}</p>
      </div>
    )
  }

  const unmatched = disc ? disc.unmatched.map((i) => store.byId.get(i)).filter((r): r is Rec => Boolean(r)) : records
  const visible = (a: Album) => show === 'all' || (show === 'yours' ? a.own.length > 0 : !a.own.length && COUNTED.includes(a.kind))

  return (
    <div className="page artist-page">
      {topbar}
      <p className="eyebrow">{page?.type === 'Person' ? 'Artist' : page?.type || 'Artist'}</p>
      <h1 className="page-title">{name}</h1>
      {error && <p className="error-note">Couldn't get their albums: {error}</p>}
      {page === null && (
        <p className="hint-note">MusicBrainz doesn't know this artist, so here's just what you have.</p>
      )}

      {disc && (
        <p className="artist-counts">
          {COUNTED.map((k) =>
            disc.counts[k].total ? (
              <span key={k}>
                <b>{disc.counts[k].have}</b> of {disc.counts[k].total} {k === 'album' ? 'studio' : 'live'}
              </span>
            ) : null,
          )}
        </p>
      )}

      {page && (page.members.length > 0 || page.bands.length > 0) && (
        <div className="artist-people">
          <h3 className="section-title">{page.members.length ? 'Members' : 'Bands'}</h3>
          <div className="chips">
            {byTenure(page.members.length ? page.members : page.bands).map((m) => (
              <button
                type="button"
                key={m.mbid}
                className="chip person-chip"
                onClick={() => go(m.discogsId ? `artist/${m.discogsId}` : `mb/${m.mbid}`)}
              >
                {m.name}
                {years(m.begin, m.end) && <span>{years(m.begin, m.end)}</span>}
              </button>
            ))}
          </div>
        </div>
      )}

      {disc && !disc.albums.length && page && (
        <p className="hint-note">MusicBrainz has no albums under this name.</p>
      )}

      {disc && disc.albums.length > 0 && (
        <div className="chips artist-show" role="group" aria-label="Show">
          {(['all', 'yours', 'missing'] as Show[]).map((s) => (
            <button key={s} type="button" className={`chip ${show === s ? 'on' : ''}`} onClick={() => setShow(s)}>
              {s === 'all' ? 'Everything' : s === 'yours' ? 'Yours' : 'Missing'}
            </button>
          ))}
        </div>
      )}

      {disc &&
        SECTIONS.map(([kind, title]) => {
          const list = disc.albums.filter((a) => a.kind === kind && visible(a))
          if (!list.length) return null
          return (
            <section key={kind}>
              <h3 className="section-title">{title}</h3>
              <ul className="results">
                {list.map((a) => (
                  <AlbumRow key={a.id} album={a} store={store} />
                ))}
              </ul>
            </section>
          )
        })}

      {unmatched.length > 0 && show !== 'missing' && (
        <section>
          <h3 className="section-title">{disc ? 'Also on your shelf' : 'On your shelf'}</h3>
          <ul className="results">
            {unmatched.map((r) => (
              <li key={r.id}>
                <button type="button" className="result" onClick={() => go(`r/${r.id}`)}>
                  <Sleeve rec={r} className="result-sleeve" />
                  <span className="result-text">
                    <span className="result-title">{r.title}</span>
                    <span className="result-artist">{yearOf(r) || ''}</span>
                  </span>
                  <span className="cube-chip">{store.spots.get(r.id)?.cube.label || '—'}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function AlbumRow({ album, store }: { album: Album; store: NonNullable<ReturnType<typeof useStore>> }) {
  const recs = album.own.map((i) => store.byId.get(i)).filter((r): r is Rec => Boolean(r))
  if (recs.length) {
    const r = recs[0]
    const out = Boolean(store.local.out[r.id])
    return (
      <li>
        <button type="button" className="result" onClick={() => go(`r/${r.id}`)}>
          <Sleeve rec={r} className="result-sleeve" />
          <span className="result-text">
            <span className="result-title">{album.title}</span>
            <span className="result-artist">
              {album.year || ''}
              {recs.length > 1 ? ` · ${recs.length} copies` : ''}
            </span>
          </span>
          <span className={`cube-chip ${out ? 'out' : ''}`}>{out ? 'Out' : store.spots.get(r.id)?.cube.label || '—'}</span>
        </button>
      </li>
    )
  }
  const href = album.masters[0]
    ? `https://www.discogs.com/master/${album.masters[0]}`
    : `https://musicbrainz.org/release-group/${album.id}`
  return (
    <li>
      <a className="result missing" href={href} target="_blank" rel="noreferrer">
        <MissingSleeve id={album.id} />
        <span className="result-text">
          <span className="result-title">{album.title}</span>
          <span className="result-artist">{album.year || ''}</span>
        </span>
        <span className="missing-chip">Missing</span>
      </a>
    </li>
  )
}

/** Longest-serving first: the line-up people know before the drummer who lasted a month. */
function byTenure<T extends { begin: string | null; end: string | null; name: string }>(people: T[]) {
  const now = new Date().getFullYear()
  const span = (p: T) => {
    const b = Number(p.begin?.slice(0, 4))
    return b ? (Number(p.end?.slice(0, 4)) || now) - b : -1
  }
  return [...people].sort((a, b) => span(b) - span(a) || a.name.localeCompare(b.name))
}

function years(begin: string | null, end: string | null) {
  const b = begin?.slice(0, 4)
  const e = end?.slice(0, 4)
  if (!b && !e) return ''
  return `${b || '?'}–${e || ''}`
}

/**
 * The cover of an album you don't have, from the Cover Art Archive (MusicBrainz's
 * sister project, keyed by the same release-group id), or an empty sleeve without one.
 */
function MissingSleeve({ id }: { id: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return <span className="result-sleeve sleeve missing-sleeve" aria-hidden />
  return (
    <img
      className="result-sleeve sleeve missing-art"
      src={`https://coverartarchive.org/release-group/${id}/front-250`}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}
