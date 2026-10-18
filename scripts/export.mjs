/**
 * Snapshot the collection into a static bundle the phone app can run from with no
 * server: every record already filed (sort name, master year, shelf, width, height),
 * the shelves and the unit layout, plus one small cover per record.
 *
 *   node scripts/export.mjs            # writes public/data/collection.json + public/covers/
 *
 * Reads only from data/ — nothing here talks to Discogs, so it is safe to re-run.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { ROOT, DATA_DIR } from '../server/config.js'
import { store } from '../server/store.js'
import { allRecords } from '../server/records.js'
import { collectPeople } from '../shared/credits.js'
import { cutters, noteParts, physical, runouts, verdict } from '../shared/pressing.js'
import { discography } from '../shared/discography.js'

const OUT = path.join(ROOT, 'public')
const COVERS = path.join(OUT, 'covers')
fs.mkdirSync(path.join(OUT, 'data'), { recursive: true })
fs.mkdirSync(COVERS, { recursive: true })

/** Where the image proxy cached a Discogs URL. Mirrors server/routes.js. */
function cachedImage(url) {
  if (!url) return null
  const hash = crypto.createHash('sha1').update(url).digest('hex')
  const ext = (url.match(/\.(jpe?g|png|gif|webp)(?:$|\?)/i) || [, 'jpg'])[1].toLowerCase()
  const file = path.join(DATA_DIR, 'images', `${hash}.${ext}`)
  return fs.existsSync(file) ? file : null
}

// Centre labels, cropped by identify/labels.py --build. Optional: without one the app
// prints a plain label.
const LABELS = path.join(OUT, 'labels')

const records = allRecords()

// What's known about each pressing: a small file per release, fetched when a record
// is opened, plus a few fields in the snapshot for the stats.
const PRESSINGS = path.join(OUT, 'pressings')
fs.mkdirSync(PRESSINGS, { recursive: true })
const readJson = (file) => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null)
const round = (n) => (typeof n === 'number' ? Math.round(n * 100) / 100 : null)
const pressings = new Map()
for (const r of records) {
  if (pressings.has(r.releaseId)) continue
  const detail = readJson(path.join(DATA_DIR, 'releases', `${r.releaseId}.json`))
  if (!detail) continue
  const versions = r.masterId ? readJson(path.join(DATA_DIR, 'versions', `${r.masterId}.json`)) : { total: 0, versions: [] }
  const market = store.market[r.releaseId] || {}
  const suggestions = market.suggestions || {}
  const price = (k) => round(suggestions[k]?.value)
  const press = versions ? verdict(detail, versions.versions, r.originalYear) : null
  const file = {
    verdict: press,
    versionCount: versions?.total ?? null,
    released: detail.released || null,
    country: detail.country || null,
    labels: (detail.labels || []).map((l) => ({ name: l.name.replace(/\s+\(\d+\)$/, ''), catno: l.catno })),
    physical: physical(detail),
    cutters: cutters(detail),
    runouts: runouts(detail),
    notes: noteParts(detail.notes),
    have: detail.community?.have ?? null,
    want: detail.community?.want ?? null,
    rating: detail.community?.rating || null,
    value: {
      currency: Object.values(suggestions)[0]?.currency || market.stats?.lowest_price?.currency || null,
      mint: price('Mint (M)'),
      nearMint: price('Near Mint (NM or M-)'),
      vgPlus: price('Very Good Plus (VG+)'),
      vg: price('Very Good (VG)'),
      lowest: round(market.stats?.lowest_price?.value),
      forSale: market.stats?.num_for_sale ?? null,
    },
    uri: detail.uri || `https://www.discogs.com/release/${r.releaseId}`,
  }
  fs.writeFileSync(path.join(PRESSINGS, `${r.releaseId}.json`), JSON.stringify(file))
  pressings.set(r.releaseId, file)
}

// Players, engineers and producers from the cached Discogs credits, for the filter.
const RELEASES = path.join(DATA_DIR, 'releases')
const { people, byRelease } = collectPeople(
  [...new Set(records.map((r) => r.releaseId))]
    .map((id) => path.join(RELEASES, `${id}.json`))
    .filter((f) => fs.existsSync(f))
    .map((f) => JSON.parse(fs.readFileSync(f, 'utf8'))),
)
const jobs = []
const out = records.map((r) => {
  // The full 600px cover beats the 150px thumb for matching a photo against.
  const source = cachedImage(r.cover) || cachedImage(r.thumb)
  const cover = source ? `covers/${r.releaseId}.jpg` : null
  if (source) jobs.push({ src: source, dst: path.join(OUT, cover) })
  return {
    id: r.instanceId,
    releaseId: r.releaseId,
    title: r.title.trim(),
    artist: r.artistName,
    credit: r.artist,
    sortName: r.sortName,
    year: r.year,
    originalYear: r.originalYear,
    shelf: r.shelf,
    width: r.width,
    height: r.height,
    format: r.formatShort,
    catno: r.catno,
    label: r.label,
    genres: r.genres,
    styles: r.styles,
    addedAt: r.addedAt,
    cover,
    remoteCover: r.cover || r.thumb || null,
    people: byRelease[r.releaseId] || [],
    masterId: r.masterId || null,
    artistId: r.artistId || null,
    ...pressFields(pressings.get(r.releaseId)),
    labelArt: fs.existsSync(path.join(LABELS, `${r.releaseId}.webp`)) ? `labels/${r.releaseId}.webp` : null,
  }
})

// Artist pages: each artist's albums from MusicBrainz (fetch-details.mjs), matched
// against the collection on the phone. Members link to their own page where there is one.
const ARTISTS = path.join(OUT, 'artists')
fs.mkdirSync(ARTISTS, { recursive: true })
const MB = path.join(DATA_DIR, 'mb')
const mbFiles = fs.existsSync(MB) ? fs.readdirSync(MB).filter((f) => f.endsWith('.json')).map((f) => readJson(path.join(MB, f))) : []
const discogsOf = new Map(mbFiles.filter((a) => a.mbid).map((a) => [a.mbid, a.discogsId]))
let artistPages = 0
for (const a of mbFiles) {
  if (!a.mbid) continue
  const page = {
    discogsId: a.discogsId,
    mbid: a.mbid,
    name: a.name.replace(/\s+\(\d+\)$/, ''),
    type: a.type,
    members: a.members.map((m) => ({ ...m, discogsId: discogsOf.get(m.mbid) || null })),
    bands: (a.bands || []).map((b) => ({ ...b, discogsId: discogsOf.get(b.mbid) || null })),
    groups: a.groups.map(({ id, title, date, primary, secondary, masters }) => ({ id, title, date, primary, secondary, masters })),
  }
  fs.writeFileSync(path.join(ARTISTS, `${a.discogsId}.json`), JSON.stringify(page))
  artistPages++
}

function pressFields(p) {
  if (!p) return {}
  const plant = p.physical.find((f) => f.startsWith('Pressed by '))
  return {
    country: p.country,
    press: p.verdict?.kind || null,
    have: p.have,
    want: p.want,
    value: p.value.vgPlus ?? null,
    plant: plant ? plant.slice('Pressed by '.length) : null,
  }
}

// Resize in one Python pass (Pillow is already in the venv) and sample each sleeve's
// average colour for its spine on the way through.
const jobFile = path.join(OUT, '.jobs.json')
fs.writeFileSync(jobFile, JSON.stringify(jobs))
const colours = JSON.parse(
  execFileSync(path.join(ROOT, '.venv/bin/python'), [path.join(ROOT, 'scripts/covers.py'), jobFile], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }),
)
fs.rmSync(jobFile)
for (const r of out) {
  if (r.cover) r.colour = colours[path.join(OUT, r.cover)] || null
}

// How complete each artist is, for the stats page (the artist page works it out live).
const completeness = {}
for (const a of mbFiles) {
  if (!a.mbid) continue
  const mine = out.filter((r) => r.artistId === a.discogsId)
  if (!mine.length) continue
  const { counts } = discography(a.groups, mine)
  completeness[a.discogsId] = [counts.album.have, counts.album.total, counts.live.have, counts.live.total]
}

const snapshot = {
  exportedAt: new Date().toISOString(),
  syncedAt: store.collection.syncedAt,
  username: store.collection.username,
  shelves: store.overrides.shelves,
  shelfMap: store.overrides.shelfMap,
  people,
  completeness,
  records: out,
}
fs.writeFileSync(path.join(OUT, 'data', 'collection.json'), JSON.stringify(snapshot))

const missing = out.filter((r) => !r.cover).length
const labelled = out.filter((r) => r.labelArt).length
const nobody = out.filter((r) => !r.people.length).length
console.log(`${out.length} records, ${out.length - missing} covers (${missing} missing), ${labelled} labels`)
console.log(`${people.length} people credited, ${nobody} records with nobody listed`)
const verdicts = {}
for (const r of out) verdicts[r.press || 'no detail'] = (verdicts[r.press || 'no detail'] || 0) + 1
console.log(`pressings: ${JSON.stringify(verdicts)}`)
console.log(`artist pages: ${artistPages} (main and featured artists)`)
