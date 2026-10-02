import { classifyShelf, cleanArtistName, deriveSortName } from '../shared/classify.js'
import { shelfHeight, shelfWidth } from '../shared/thickness.js'
import { getStore, update } from './store'
import type { Rec } from './types'

/**
 * Catching up with Discogs from the phone. The collection is public, and the API
 * allows browser requests, so records bought since the snapshot can be filed with
 * the same rules as everything else — no server and no login.
 *
 * Unauthenticated calls are limited to 25 a minute, so requests are spaced out. A
 * new record costs at most two extra calls (its artist, to tell a person from a band,
 * and its master release, for the year the album first came out), and the artist
 * call is skipped whenever another record by them is already filed.
 */

const API = 'https://api.discogs.com'
const GAP_MS = 2600

let last = 0
async function get(path: string) {
  const wait = last + GAP_MS - Date.now()
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  last = Date.now()
  const res = await fetch(`${API}${path}`)
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 30000))
    return get(path)
  }
  if (!res.ok) throw new Error(`Discogs said ${res.status}`)
  return res.json()
}

export interface CheckProgress {
  stage: string
  done?: number
  total?: number
}

export async function checkDiscogs(onProgress: (p: CheckProgress) => void) {
  const store = getStore()
  if (!store) throw new Error('Not loaded yet')
  const username = store.snapshot.username
  const items: any[] = []
  let page = 1
  let pages = 1
  do {
    onProgress({ stage: 'Reading your collection', done: page - 1, total: pages })
    const data = await get(
      `/users/${encodeURIComponent(username)}/collection/folders/0/releases?per_page=100&page=${page}`,
    )
    pages = data.pagination?.pages || 1
    items.push(...(data.releases || []))
    page++
  } while (page <= pages)

  const live = new Set(items.map((i) => i.instance_id as number))
  const known = new Set([...store.snapshot.records, ...store.local.fresh].map((r) => r.id))
  const incoming = items.filter((i) => !known.has(i.instance_id))
  const gone = [...known].filter((id) => !live.has(id))

  // Reuse the filing of an artist already on the shelf — it carries any hand-set
  // sort name and Discogs' person/band verdict for free.
  const filedAs = new Map<string, string>()
  for (const r of store.records) filedAs.set(cleanArtistName(r.artist).toLowerCase(), r.sortName)

  const fresh: Rec[] = []
  for (const [n, item] of incoming.entries()) {
    onProgress({ stage: 'Filing new records', done: n, total: incoming.length })
    fresh.push(await toRecord(item, filedAs))
  }

  update((l) => {
    const keep = l.fresh.filter((r) => live.has(r.id))
    l.fresh = [...keep, ...fresh]
    l.gone = gone
    l.lastCheck = new Date().toISOString()
  })
  return { added: fresh, gone: gone.length }
}

async function toRecord(item: any, filedAs: Map<string, string>): Promise<Rec> {
  const b = item.basic_information
  const artists = b.artists || []
  const primary = artists.find((a: any) => a.id && a.id !== 194) || artists[0]
  const name = cleanArtistName(primary?.name || 'Various')
  let sortName = filedAs.get(name.toLowerCase())
  if (!sortName) {
    let info = null
    if (primary?.id && primary.id !== 194) {
      try {
        const a = await get(`/artists/${primary.id}`)
        const type = a.members?.length ? 'group' : a.realname?.trim() ? 'person' : null
        info = type ? { type } : null
      } catch {
        /* fall back to the name-shape guess */
      }
    }
    sortName = deriveSortName(name, info, null).sortName
    filedAs.set(name.toLowerCase(), sortName!)
  }

  let originalYear = b.year || null
  if (b.master_id) {
    try {
      const m = await get(`/masters/${b.master_id}`)
      if (m.year) originalYear = m.year
    } catch {
      /* keep the pressing year */
    }
  }

  const info = {
    title: b.title,
    artist: name,
    formats: b.formats || [],
    genres: b.genres || [],
    styles: b.styles || [],
  }
  const shelves = new Set(getStore()!.snapshot.shelves.map((s) => s.id))
  const shelf = classifyShelf(info)
  const descs = (b.formats || []).flatMap((f: any) => f.descriptions || [])

  return {
    id: item.instance_id,
    releaseId: b.id,
    title: String(b.title || '').trim(),
    artist: name,
    credit: artists.map((a: any) => a.anv || a.name).join(', '),
    sortName: sortName!,
    year: b.year || null,
    originalYear,
    shelf: shelves.has(shelf) ? shelf : 'main',
    width: shelfWidth(info, null) as number,
    height: shelfHeight(info) as number,
    format: descs.find((d: string) => /^(LP|EP|\d+"|Single|Album|Compilation)$/i.test(d)) || b.formats?.[0]?.name || '',
    catno: b.labels?.[0]?.catno || '',
    label: b.labels?.[0]?.name || '',
    genres: b.genres || [],
    styles: b.styles || [],
    addedAt: item.date_added,
    cover: null,
    remoteCover: b.cover_image || b.thumb || null,
    colour: null,
    fresh: true,
  }
}
