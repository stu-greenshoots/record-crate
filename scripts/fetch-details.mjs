/**
 * The extra detail behind the pressing notes, the artist pages and the stats. Each
 * part only fetches what isn't already in data/, so it can be re-run.
 *
 *   node scripts/fetch-details.mjs
 *
 *   data/versions/<masterId>.json  every vinyl version of the album, oldest first
 *                                  (to tell an original pressing from a reissue)
 *   data/market.json               price suggestions and lowest price, per release
 *   data/mb/<artistId>.json        the artist's MusicBrainz release groups (album,
 *                                  live, compilation…) with their Discogs links, and
 *                                  the band's members. Bootlegs are left out, as on
 *                                  the MusicBrainz website: Bob Dylan has ~300
 *                                  release groups that way and 1,200 with them.
 *
 * Discogs (logged in, ~50 calls a minute) and MusicBrainz (one call a second, no
 * login) have separate limits, so the two run side by side.
 */
import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR, config } from '../server/config.js'
import { store } from '../server/store.js'
import { api } from '../server/discogs.js'

const VERSIONS = path.join(DATA_DIR, 'versions')
const MB = path.join(DATA_DIR, 'mb')
fs.mkdirSync(VERSIONS, { recursive: true })
fs.mkdirSync(MB, { recursive: true })

const VARIOUS = 194
// Bump to fetch every artist again after changing what's asked for.
const MB_VERSION = 2
const items = store.collection.items

function writeAtomic(file, value) {
  fs.writeFileSync(`${file}.part`, JSON.stringify(value))
  fs.renameSync(`${file}.part`, file)
}

async function discogs() {
  if (!store.auth) {
    console.error('Not connected to Discogs: run `npm run server` and connect first.')
    return
  }
  const masters = [...new Set(items.map((i) => i.masterId).filter(Boolean))].filter(
    (id) => !fs.existsSync(path.join(VERSIONS, `${id}.json`)),
  )
  let n = 0
  for (const id of masters) {
    const data = await api(`/masters/${id}/versions?format=Vinyl&sort=released&sort_order=asc&per_page=100`)
    const versions = (data?.versions || []).map((v) => ({
      id: v.id,
      released: v.released || null,
      country: v.country || null,
      label: v.label || null,
      catno: v.catno || null,
      format: v.format || null,
    }))
    writeAtomic(path.join(VERSIONS, `${id}.json`), { total: data?.pagination?.items ?? versions.length, versions })
    if (++n % 25 === 0) console.log(`versions: ${n}/${masters.length}`)
  }
  console.log(`versions: ${masters.length} fetched`)

  const unpriced = [...new Set(items.map((i) => i.releaseId))].filter((id) => !store.market[id]?.suggestions)
  n = 0
  for (const id of unpriced) {
    const stats = await api(`/marketplace/stats/${id}?curr_abbr=${encodeURIComponent(config.currency)}`)
    const suggestions = await api(`/marketplace/price_suggestions/${id}`).catch(() => null)
    store.market[id] = { fetchedAt: Date.now(), stats, suggestions }
    if (++n % 25 === 0) {
      store.flush('market')
      console.log(`prices: ${n}/${unpriced.length}`)
    }
  }
  store.flush('market')
  console.log(`prices: ${unpriced.length} fetched`)
}

let lastMb = 0
async function mb(pathAndQuery) {
  for (let attempt = 0; attempt < 6; attempt++) {
    const wait = lastMb + 1100 - Date.now()
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    lastMb = Date.now()
    const res = await fetch(`https://musicbrainz.org/ws/2/${pathAndQuery}${pathAndQuery.includes('?') ? '&' : '?'}fmt=json`, {
      headers: { 'User-Agent': 'RecordCrate/1.0 ( https://stu-greenshoots.github.io/record-crate/ )' },
    })
    if (res.status === 404) return null
    if (res.status === 503 || res.status === 429) {
      await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)))
      continue
    }
    if (!res.ok) throw new Error(`MusicBrainz ${res.status} for ${pathAndQuery}`)
    return res.json()
  }
  throw new Error(`MusicBrainz kept saying busy for ${pathAndQuery}`)
}

async function musicbrainz() {
  const artists = new Map()
  for (const i of items) {
    for (const a of i.info.artists || []) if (a.id && a.id !== VARIOUS) artists.set(a.id, a.name)
  }
  const todo = [...artists].filter(([id]) => {
    const file = path.join(MB, `${id}.json`)
    return !fs.existsSync(file) || JSON.parse(fs.readFileSync(file, 'utf8')).version !== MB_VERSION
  })
  let n = 0
  for (const [id, name] of todo) {
    try {
      const url = await mb(`url?resource=${encodeURIComponent(`https://www.discogs.com/artist/${id}`)}&inc=artist-rels`)
      const mbid = url?.relations?.find((r) => r.artist)?.artist?.id || null
      if (!mbid) {
        writeAtomic(path.join(MB, `${id}.json`), { version: MB_VERSION, discogsId: id, name, mbid: null, fetchedAt: Date.now() })
        continue
      }
      const artist = await mb(`artist/${mbid}?inc=artist-rels`)
      const members = (artist?.relations || [])
        .filter((r) => r.type === 'member of band' && r.direction === 'backward')
        .map((r) => ({
          mbid: r.artist.id,
          name: r.artist.name,
          begin: r.begin || null,
          end: r.end || null,
          ended: Boolean(r.ended),
          roles: r.attributes || [],
        }))
      const groups = []
      for (let offset = 0; ; offset += 100) {
        const page = await mb(
          `release-group?artist=${mbid}&limit=100&offset=${offset}&inc=url-rels&release-group-status=website-default`,
        )
        for (const g of page?.['release-groups'] || []) {
          groups.push({
            id: g.id,
            title: g.title,
            date: g['first-release-date'] || null,
            primary: g['primary-type'] || null,
            secondary: g['secondary-types'] || [],
            masters: (g.relations || [])
              .map((r) => r.url?.resource?.match(/discogs\.com\/master\/(\d+)/)?.[1])
              .filter(Boolean)
              .map(Number),
          })
        }
        if (!page || offset + 100 >= (page['release-group-count'] || 0)) break
      }
      writeAtomic(path.join(MB, `${id}.json`), {
        version: MB_VERSION,
        discogsId: id,
        name,
        mbid,
        type: artist?.type || null,
        members,
        groups,
        fetchedAt: Date.now(),
      })
    } catch (err) {
      // Leave no file, so the next run tries this artist again.
      console.warn(`musicbrainz ${name}: ${err.message}`)
    }
    if (++n % 25 === 0) console.log(`musicbrainz: ${n}/${todo.length}`)
  }
  console.log(`musicbrainz: ${todo.length} artists looked up`)
}

await Promise.all([discogs(), musicbrainz()])
process.exit(0)
