/**
 * Catch data/ up with Discogs before a snapshot: pull the collection, crawl the
 * artist/master details that filing needs, and download any covers not yet cached.
 *
 *   node scripts/sync.mjs     # needs data/auth.json (connect once via the legacy server)
 *
 * Then `npm run snapshot && npm run deploy`, or `npm run refresh` for all three.
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DATA_DIR, config } from '../server/config.js'
import { store } from '../server/store.js'
import { syncCollection } from '../server/sync.js'
import { enrichState, startEnrichment } from '../server/enrich.js'

if (!store.auth) {
  console.error('Not connected to Discogs: run `npm run server` and connect first.')
  process.exit(1)
}

const before = store.collection.items.length
const state = await syncCollection()
console.log(`collection: ${store.collection.items.length} records (${state.added || 0} new, was ${before})`)

startEnrichment()
await new Promise((resolve) => {
  const tick = setInterval(() => {
    const { releases, artists, masters } = enrichState
    process.stdout.write(
      `\rdetails: releases ${releases.done}/${releases.total}, artists ${artists.done}/${artists.total}, masters ${masters.done}/${masters.total}   `,
    )
    if (!enrichState.running) {
      clearInterval(tick)
      resolve()
    }
  }, 1000)
})
console.log()
if (enrichState.error) console.warn(`details stopped early: ${enrichState.error}`)

// Same file naming as the server's image proxy, which export.mjs reads from.
const IMG_DIR = path.join(DATA_DIR, 'images')
fs.mkdirSync(IMG_DIR, { recursive: true })
let fetched = 0
for (const item of store.collection.items) {
  const url = item.info.cover || item.info.thumb
  if (!url) continue
  const hash = crypto.createHash('sha1').update(url).digest('hex')
  const ext = (url.match(/\.(jpe?g|png|gif|webp)(?:$|\?)/i) || [, 'jpg'])[1].toLowerCase()
  const file = path.join(IMG_DIR, `${hash}.${ext}`)
  if (fs.existsSync(file)) continue
  const res = await fetch(url, { headers: { 'User-Agent': config.userAgent } })
  if (!res.ok) {
    console.warn(`cover ${item.releaseId}: ${res.status}`)
    continue
  }
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()))
  fetched++
}
console.log(`covers: ${fetched} downloaded`)
process.exit(0)
