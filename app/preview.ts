import { cut, sides as sidesFrom } from '../shared/sides.js'
import type { Rec, Side } from './types'

/**
 * An album you don't own, as a record you could put on the turntable: its tracks from
 * MusicBrainz, its cover from the Cover Art Archive. Nothing is kept; it's a look
 * before buying.
 */
export interface Preview {
  rec: Rec
  /** Its Discogs master, where MusicBrainz links one, for finding a copy. */
  masterId: number | null
}

const MB = 'https://musicbrainz.org/ws/2'

async function mb(path: string) {
  const res = await fetch(`${MB}/${path}${path.includes('?') ? '&' : '?'}fmt=json`)
  if (!res.ok) throw new Error(`MusicBrainz ${res.status}`)
  return res.json()
}

const mmss = (ms: number | null) => (ms ? `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, '0')}` : '')

/** A stable negative id, so a preview can never be mistaken for one of your records. */
function idOf(mbid: string) {
  let h = 0
  for (const c of mbid) h = (Math.imul(h, 31) + c.charCodeAt(0)) | 0
  return -Math.abs(h || 1)
}

/**
 * The album's tracks as sides. A vinyl release names them (A1, B1…); a CD-era album
 * is cut onto sides as a record of it would be (shared/sides.js).
 */
function toSides(tracks: { number: string; title: string; length: number | null }[]): Side[] {
  const named = sidesFrom(tracks.map((t) => ({ position: t.number, title: t.title, duration: mmss(t.length) }))) as Side[]
  if (named.some((s) => s.tracks.length)) return named
  return cut(tracks.map((t) => ({ title: t.title, seconds: t.length ? Math.round(t.length / 1000) : null }))) as Side[]
}

export async function loadPreview(rgid: string): Promise<Preview> {
  const group = await mb(`release-group/${rgid}?inc=artist-credits+url-rels`)
  const found = await mb(`release?release-group=${rgid}&inc=media+recordings&status=official&limit=40`)
  const releases: any[] = found.releases || []
  // A vinyl release if there is one (it names the sides), the earliest first.
  const byDate = [...releases].sort((a, b) => String(a.date || '9999').localeCompare(String(b.date || '9999')))
  const release =
    byDate.find((r) => r.media?.some((m: any) => /vinyl/i.test(m.format || '')) && r.media.every((m: any) => m.tracks?.length)) ||
    byDate.find((r) => r.media?.every((m: any) => m.tracks?.length))
  const tracks = (release?.media || [])
    .filter((m: any) => !/dvd|blu-?ray/i.test(m.format || ''))
    .flatMap((m: any) => m.tracks || [])
    .map((t: any) => ({ number: String(t.number || ''), title: t.title, length: t.length ?? t.recording?.length ?? null }))
  const sides = toSides(tracks)
  const artist = (group['artist-credit'] || []).map((c: any) => `${c.name}${c.joinphrase || ''}`).join('') || 'Unknown'
  const year = Number(String(group['first-release-date'] || '').slice(0, 4)) || null
  const id = idOf(rgid)
  const masterId = Number(
    (group.relations || []).map((r: any) => r.url?.resource?.match(/discogs\.com\/master\/(\d+)/)?.[1]).find(Boolean),
  ) || null
  const rec: Rec = {
    id,
    releaseId: id,
    title: group.title,
    artist,
    credit: artist,
    sortName: artist,
    year,
    originalYear: year,
    shelf: '',
    width: 1,
    height: 1,
    format: 'LP',
    catno: '',
    label: '',
    genres: [],
    styles: [],
    addedAt: '',
    cover: null,
    remoteCover: `https://coverartarchive.org/release-group/${rgid}/front-500`,
    faces: sides.map((s) => ({ side: s.side })),
    sides,
  }
  return { rec, masterId }
}
