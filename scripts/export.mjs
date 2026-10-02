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

const records = allRecords()
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
  }
})

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

const snapshot = {
  exportedAt: new Date().toISOString(),
  syncedAt: store.collection.syncedAt,
  username: store.collection.username,
  shelves: store.overrides.shelves,
  shelfMap: store.overrides.shelfMap,
  records: out,
}
fs.writeFileSync(path.join(OUT, 'data', 'collection.json'), JSON.stringify(snapshot))

const missing = out.filter((r) => !r.cover).length
console.log(`${out.length} records, ${out.length - missing} covers (${missing} missing)`)
