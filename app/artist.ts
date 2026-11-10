/**
 * Artist pages: a band's or person's albums from MusicBrainz. Artists in the
 * collection have theirs exported with the snapshot (public/artists/<discogsId>.json);
 * anyone else (a band member, say) is looked up live, MusicBrainz allowing one call a
 * second and no login.
 */

export interface Member {
  mbid: string
  name: string
  discogsId: number | null
  begin: string | null
  end: string | null
  ended: boolean
  roles: string[]
}

export interface Band {
  mbid: string
  name: string
  discogsId: number | null
  begin: string | null
  end: string | null
}

export interface Group {
  id: string
  title: string
  date: string | null
  primary: string | null
  secondary: string[]
  masters: number[]
}

export interface ArtistPage {
  discogsId: number | null
  mbid: string | null
  name: string
  type: string | null
  members: Member[]
  /** For a person, the bands they were in. */
  bands: Band[]
  groups: Group[]
}

const cache = new Map<string, Promise<ArtistPage | null>>()

export function loadArtist(key: { discogsId?: number; mbid?: string }) {
  const k = key.discogsId ? `d${key.discogsId}` : `m${key.mbid}`
  if (!cache.has(k)) {
    const p = key.discogsId ? fromSnapshot(key.discogsId) : fromMusicBrainz(key.mbid!)
    // A failed live lookup can be tried again; a missing page can't.
    p.catch(() => cache.delete(k))
    cache.set(k, p)
  }
  return cache.get(k)!
}

async function fromSnapshot(id: number): Promise<ArtistPage | null> {
  const res = await fetch(`${import.meta.env.BASE_URL}artists/${id}.json`)
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`Couldn't load the artist (${res.status})`)
  return res.json()
}

let last = 0
async function mb(path: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const wait = last + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    last = Date.now()
    const res = await fetch(`https://musicbrainz.org/ws/2/${path}${path.includes('?') ? '&' : '?'}fmt=json`)
    if (res.status === 503) {
      await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)))
      continue
    }
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`MusicBrainz said ${res.status}`)
    return res.json()
  }
  throw new Error('MusicBrainz is busy; try again in a minute')
}

async function fromMusicBrainz(mbid: string): Promise<ArtistPage | null> {
  const artist = await mb(`artist/${mbid}?inc=artist-rels`)
  if (!artist) return null
  const groups: Group[] = []
  for (let offset = 0; ; offset += 100) {
    const page = await mb(`release-group?artist=${mbid}&limit=100&offset=${offset}&inc=url-rels&release-group-status=website-default`)
    for (const g of page?.['release-groups'] || []) {
      groups.push({
        id: g.id,
        title: g.title,
        date: g['first-release-date'] || null,
        primary: g['primary-type'] || null,
        secondary: g['secondary-types'] || [],
        masters: (g.relations || [])
          .map((r: any) => r.url?.resource?.match(/discogs\.com\/master\/(\d+)/)?.[1])
          .filter(Boolean)
          .map(Number),
      })
    }
    if (!page || offset + 100 >= (page['release-group-count'] || 0)) break
  }
  const members = (artist.relations || [])
    .filter((r: any) => r.type === 'member of band' && r.direction === 'backward')
    .map((r: any) => ({
      mbid: r.artist.id,
      name: r.artist.name,
      discogsId: null,
      begin: r.begin || null,
      end: r.end || null,
      ended: Boolean(r.ended),
      roles: r.attributes || [],
    }))
  const bands = (artist.relations || [])
    .filter((r: any) => r.type === 'member of band' && r.direction === 'forward')
    .map((r: any) => ({ mbid: r.artist.id, name: r.artist.name, discogsId: null, begin: r.begin || null, end: r.end || null }))
  return { discogsId: null, mbid, name: artist.name, type: artist.type || null, members, bands, groups }
}
