import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { config, DATA_DIR } from './config.js'
import { store } from './store.js'
import { getRequestToken, getAccessToken, authorizeUrlFor, apiState, limiter } from './discogs.js'
import { syncCollection, syncState, whoAmI } from './sync.js'
import { api } from './discogs.js'
import {
  startEnrichment,
  enrichState,
  fetchMarket,
  fetchReleaseDetail,
  priceEverything,
} from './enrich.js'
import { allRecords, sortRecords, SORT_MODES, buildRecord } from './records.js'
import { collationKey } from '../shared/classify.js'
import { buildShelfMap, locate, DEFAULT_MAP } from '../shared/shelfmap.js'
import { placeRecord, candidateFromRelease } from './place.js'
import { readBackCover, pythonAvailable, catnoSimilarity } from './identify.js'

export const router = express.Router()

/** In-flight OAuth request tokens, keyed by oauth_token. */
const pendingTokens = new Map()

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

function baseUrl(req) {
  return `${req.protocol}://${req.get('host')}`
}

/* ------------------------------------------------------------------ */
/* Auth                                                                */
/* ------------------------------------------------------------------ */

router.get(
  '/auth/login',
  wrap(async (req, res) => {
    const callback = `${baseUrl(req)}/api/auth/callback`
    const token = await getRequestToken(callback)
    pendingTokens.set(token.oauth_token, token.oauth_token_secret)
    res.redirect(authorizeUrlFor(token.oauth_token))
  }),
)

router.get(
  '/auth/callback',
  wrap(async (req, res) => {
    const { oauth_token: token, oauth_verifier: verifier, denied } = req.query
    if (denied) return res.redirect('/?auth=denied')
    const secret = pendingTokens.get(token)
    if (!secret) return res.redirect('/?auth=expired')
    pendingTokens.delete(token)

    const access = await getAccessToken(token, secret, verifier)
    store.setAuth({ token: access.oauth_token, tokenSecret: access.oauth_token_secret })

    const me = await whoAmI()
    store.setAuth({ ...store.auth, ...me })
    res.redirect('/?auth=ok')
  }),
)

router.post('/auth/logout', (req, res) => {
  store.clearAuth()
  res.json({ ok: true })
})

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

router.get('/state', (req, res) => {
  res.json({
    authed: Boolean(store.auth),
    user: store.auth
      ? {
          username: store.auth.username,
          name: store.auth.name,
          avatar: store.auth.avatar,
          profileUrl: store.auth.profileUrl,
        }
      : null,
    collection: {
      count: store.collection.items.length,
      syncedAt: store.collection.syncedAt,
    },
    sync: syncState,
    enrich: enrichState,
    api: { remaining: apiState.remaining, queued: limiter.depth },
    shelves: store.overrides.shelves,
    settings: store.overrides.settings,
    sortModes: Object.entries(SORT_MODES).map(([id, m]) => ({ id, label: m.label })),
    currency: config.currency,
  })
})

router.patch('/settings', (req, res) => {
  Object.assign(store.overrides.settings, req.body || {})
  store.save('overrides')
  res.json(store.overrides.settings)
})

/* ------------------------------------------------------------------ */
/* Collection                                                          */
/* ------------------------------------------------------------------ */

router.post(
  '/sync',
  wrap(async (req, res) => {
    if (!store.auth) return res.status(401).json({ error: 'Not connected to Discogs' })
    await syncCollection()
    startEnrichment()
    res.json({ ok: true, count: store.collection.items.length, added: syncState.added || 0 })
  }),
)

router.get('/records', (req, res) => {
  const mode = req.query.sort || store.overrides.settings.sortMode || 'smart'
  const records = sortRecords(allRecords(), mode)
  const counts = {}
  for (const r of records) counts[r.shelf] = (counts[r.shelf] || 0) + 1
  res.json({ records, counts, sortMode: mode, syncedAt: store.collection.syncedAt })
})

router.get(
  '/records/:instanceId',
  wrap(async (req, res) => {
    const item = store.collection.items.find((i) => String(i.instanceId) === req.params.instanceId)
    if (!item) return res.status(404).json({ error: 'Not in your collection' })

    let detail = store.getRelease(item.releaseId)
    if (!detail || detail.missing) {
      // The crawl hasn't reached it yet — jump the queue for the record on screen.
      try {
        detail = await fetchReleaseDetail(item.releaseId)
      } catch (err) {
        if (err.status === 401) throw err
      }
    }

    // Prices go stale, so they are fetched lazily on open rather than in the crawl.
    let market = store.getMarket(item.releaseId)
    if (!market) {
      try {
        market = await fetchMarket(item.releaseId)
      } catch {}
    }

    // Where this copy physically stands, so the panel can say "cube 5, row 2".
    const built = buildShelfMap(store.overrides.shelfMap, allRecords(), store.overrides.shelves)
    const cube = locate(built, item.instance_id ?? item.instanceId)

    res.json({
      record: buildRecord(item),
      detail: detail || null,
      market: market || null,
      cube: cube
        ? { index: cube.index, row: cube.row, col: cube.col, label: cube.label, count: cube.count }
        : null,
    })
  }),
)

router.post(
  '/records/:instanceId/market',
  wrap(async (req, res) => {
    const item = store.collection.items.find((i) => String(i.instanceId) === req.params.instanceId)
    if (!item) return res.status(404).json({ error: 'Not in your collection' })
    const market = await fetchMarket(item.releaseId, { force: req.query.force === '1' })
    res.json({ market })
  }),
)

router.patch('/records/:instanceId', (req, res) => {
  const key = req.params.instanceId
  const current = store.overrides.records[key]
  if (!current) return res.status(404).json({ error: 'Unknown record' })
  const { shelf } = req.body || {}
  if (shelf) {
    if (!store.overrides.shelves.some((s) => s.id === shelf)) {
      return res.status(400).json({ error: 'Unknown shelf' })
    }
    current.shelf = shelf
    current.position = null
    current.movedAt = Date.now()
  }
  store.save('overrides')
  res.json({ ok: true, record: current })
})

/** Persist an explicit drag order for one shelf. */
router.post('/shelves/:id/order', (req, res) => {
  const { instanceIds } = req.body || {}
  if (!Array.isArray(instanceIds)) return res.status(400).json({ error: 'instanceIds required' })
  instanceIds.forEach((id, index) => {
    const rec = store.overrides.records[String(id)]
    if (rec) {
      rec.shelf = req.params.id
      rec.position = index
    }
  })
  store.overrides.settings.sortMode = 'manual'
  store.save('overrides')
  res.json({ ok: true })
})

/**
 * Freeze the current computed order into manual positions, so the user can start
 * from a smart sort and then nudge individual records around.
 */
router.post('/shelves/:id/freeze', (req, res) => {
  const mode = req.body?.sort || store.overrides.settings.sortMode || 'smart'
  const records = sortRecords(allRecords().filter((r) => r.shelf === req.params.id), mode)
  records.forEach((r, index) => {
    const rec = store.overrides.records[String(r.instanceId)]
    if (rec) rec.position = index
  })
  store.save('overrides')
  res.json({ ok: true, count: records.length })
})

/* ------------------------------------------------------------------ */
/* Shelves                                                             */
/* ------------------------------------------------------------------ */

router.post('/shelves', (req, res) => {
  const name = String(req.body?.name || '').trim()
  if (!name) return res.status(400).json({ error: 'Name required' })
  const id = `s${crypto.randomBytes(4).toString('hex')}`
  store.overrides.shelves.push({ id, name, hint: req.body?.hint || '' })
  store.save('overrides')
  res.json({ ok: true, shelf: { id, name } })
})

router.patch('/shelves/:id', (req, res) => {
  const shelf = store.overrides.shelves.find((s) => s.id === req.params.id)
  if (!shelf) return res.status(404).json({ error: 'Unknown shelf' })
  if (req.body?.name != null) shelf.name = String(req.body.name).trim() || shelf.name
  if (req.body?.hint != null) shelf.hint = String(req.body.hint)
  store.save('overrides')
  res.json({ ok: true, shelf })
})

router.delete('/shelves/:id', (req, res) => {
  const { id } = req.params
  if (store.overrides.shelves.length <= 1) {
    return res.status(400).json({ error: 'Keep at least one shelf' })
  }
  const moveTo = req.query.moveTo || store.overrides.shelves.find((s) => s.id !== id)?.id
  store.overrides.shelves = store.overrides.shelves.filter((s) => s.id !== id)
  let moved = 0
  for (const rec of Object.values(store.overrides.records)) {
    if (rec.shelf === id) {
      rec.shelf = moveTo
      rec.position = null
      moved += 1
    }
  }
  store.save('overrides')
  res.json({ ok: true, moved, moveTo })
})

router.post('/shelves/reorder', (req, res) => {
  const { ids } = req.body || {}
  if (!Array.isArray(ids)) return res.status(400).json({ error: 'ids required' })
  const byId = new Map(store.overrides.shelves.map((s) => [s.id, s]))
  const next = ids.map((id) => byId.get(id)).filter(Boolean)
  for (const s of store.overrides.shelves) if (!ids.includes(s.id)) next.push(s)
  store.overrides.shelves = next
  store.save('overrides')
  res.json({ ok: true, shelves: next })
})

/** Re-run auto-classification. Only touches records the user hasn't moved by hand. */
router.post('/shelves/reclassify', async (req, res) => {
  const { classifyShelf } = await import('../shared/classify.js')
  const known = new Set(store.overrides.shelves.map((s) => s.id))
  let changed = 0
  for (const item of store.collection.items) {
    const rec = store.overrides.records[String(item.instanceId)]
    if (!rec || rec.movedAt) continue
    const shelf = classifyShelf({ ...item.info })
    const target = known.has(shelf) ? shelf : 'main'
    if (rec.shelf !== target) {
      rec.shelf = target
      rec.autoShelf = shelf
      changed += 1
    }
  }
  store.save('overrides')
  res.json({ ok: true, changed })
})

/* ------------------------------------------------------------------ */
/* The physical unit                                                   */
/* ------------------------------------------------------------------ */

router.get('/shelf-map', (req, res) => {
  res.json(buildShelfMap(store.overrides.shelfMap, allRecords(), store.overrides.shelves))
})

router.patch('/shelf-map', (req, res) => {
  const map = store.overrides.shelfMap
  const { cols, rows, capacity, flowShelf, slots } = req.body || {}

  if (cols != null) map.cols = Math.max(1, Math.min(8, Number(cols) || map.cols))
  if (rows != null) map.rows = Math.max(1, Math.min(8, Number(rows) || map.rows))
  if (capacity != null) map.capacity = Math.max(1, Math.min(500, Number(capacity) || map.capacity))
  if (flowShelf) map.flowShelf = flowShelf
  if (Array.isArray(slots)) map.slots = slots

  // Grow or trim the slot list to match the grid, defaulting new cubes to the flow.
  const needed = map.cols * map.rows
  while (map.slots.length < needed) map.slots.push({ type: 'flow' })
  map.slots.length = needed

  store.save('overrides')
  res.json(buildShelfMap(map, allRecords(), store.overrides.shelves))
})

router.post('/shelf-map/reset', (req, res) => {
  store.overrides.shelfMap = structuredClone(DEFAULT_MAP)
  store.save('overrides')
  res.json(buildShelfMap(store.overrides.shelfMap, allRecords(), store.overrides.shelves))
})

/* ------------------------------------------------------------------ */
/* "Where does this go?"                                               */
/* ------------------------------------------------------------------ */

/** Search Discogs for a record you're holding — by barcode, or by artist and title. */
/** The shape the "which one is it?" list renders, from a Discogs search result. */
function summariseResults(results) {
  return results.map((r) => ({
    releaseId: r.id,
    title: r.title,
    year: r.year || null,
    thumb: r.thumb || null,
    cover: r.cover_image || r.thumb || null,
    format: (r.format || []).join(', '),
    label: (r.label || [])[0] || null,
    catno: r.catno || null,
    country: r.country || null,
  }))
}

router.get(
  '/lookup',
  wrap(async (req, res) => {
    const { barcode, q, catno } = req.query
    if (!barcode && !q && !catno) {
      return res.status(400).json({ error: 'Give a barcode, a catalogue number or a search' })
    }

    const params = new URLSearchParams({ type: 'release', per_page: '12' })
    if (barcode) params.set('barcode', String(barcode).replace(/\s+/g, ''))
    if (catno) params.set('catno', String(catno))
    if (q) params.set('q', String(q))

    const found = await api(`/database/search?${params}`, { priority: 0 })
    res.json({
      results: summariseResults(found?.results || []),
      via: barcode ? 'barcode' : catno ? 'catno' : 'search',
    })
  }),
)

/* ------------------------------------------------------------------ */
/* Reading the back of a sleeve                                        */
/* ------------------------------------------------------------------ */

/**
 * Every catalogue number in the collection, mapped to what it belongs to.
 *
 * Catalogue numbers are near-unique here — 752 distinct across 609 releases, with
 * the only collisions being a pressing genuinely owned twice — so this answers
 * "do I already have this?" from disk, before any network call.
 */
function ownedByCatno() {
  const index = []
  for (const item of store.collection.items) {
    const detail = store.getRelease(item.releaseId)
    for (const label of detail?.labels || []) {
      if (label.catno) index.push({ catno: label.catno, instanceId: item.instanceId })
    }
  }
  return index
}

/** Rank Discogs results by how well their catalogue number matches what was read. */
function rankByCatno(results, read) {
  return results
    .map((r) => ({ ...r, match: r.catno ? catnoSimilarity(read, r.catno) : null }))
    .filter((r) => r.match !== null)
    .sort((a, b) => b.match - a.match)
}

router.post(
  '/identify/back',
  express.raw({ type: ['image/*', 'application/octet-stream'], limit: '25mb' }),
  wrap(async (req, res) => {
    if (!pythonAvailable()) {
      return res.status(503).json({ error: 'The photo reader needs the Python environment' })
    }
    if (!req.body?.length) return res.status(400).json({ error: 'No photo received' })

    const file = path.join(os.tmpdir(), `crate-read-${crypto.randomBytes(6).toString('hex')}.jpg`)
    fs.writeFileSync(file, req.body)
    let read
    try {
      read = await readBackCover(file)
    } finally {
      fs.rmSync(file, { force: true })
    }

    // What was read against what's already on the shelf — no network needed.
    const owned = []
    const shelved = ownedByCatno()
    for (const candidate of read.catalogueNumbers || []) {
      for (const entry of shelved) {
        const score = catnoSimilarity(candidate.value, entry.catno)
        if (score !== null) owned.push({ ...entry, read: candidate.value, match: score })
      }
    }
    owned.sort((a, b) => b.match - a.match)

    // Then Discogs, catalogue number first because it names a pressing, falling
    // back to the biggest type on the sleeve when no number survived the read.
    let results = []
    let via = null
    for (const candidate of (read.catalogueNumbers || []).slice(0, 3)) {
      const params = new URLSearchParams({
        type: 'release', per_page: '20', catno: candidate.value,
      })
      const found = await api(`/database/search?${params}`, { priority: 0 })
      const ranked = rankByCatno(summariseResults(found?.results || []), candidate.value)
      if (ranked.length) {
        results = ranked
        via = 'catno'
        break
      }
    }

    if (!results.length && read.searchTerms) {
      const params = new URLSearchParams({
        type: 'release', per_page: '12', q: read.searchTerms,
      })
      const found = await api(`/database/search?${params}`, { priority: 0 })
      results = summariseResults(found?.results || [])
      via = results.length ? 'text' : null
    }

    res.json({
      read: {
        catalogueNumbers: read.catalogueNumbers || [],
        phrases: (read.phrases || []).map((p) => p.text),
        searchTerms: read.searchTerms || null,
        pixelsAcross: read.pixelsAcross || 0,
        resolutionOk: read.resolutionOk !== false,
      },
      owned: owned.slice(0, 3),
      results: results.slice(0, 12),
      via,
    })
  }),
)

/**
 * Where a record belongs on the unit. Accepts one you already own (instanceId) or
 * any Discogs release (releaseId) — a record you're thinking of buying included.
 */
router.post(
  '/place',
  wrap(async (req, res) => {
    const { instanceId, releaseId } = req.body || {}

    if (instanceId) {
      const item = store.collection.items.find((i) => String(i.instanceId) === String(instanceId))
      if (!item) return res.status(404).json({ error: 'Not in your collection' })
      const record = buildRecord(item)
      return res.json({ record, placement: placeRecord(record) })
    }

    if (!releaseId) return res.status(400).json({ error: 'Give an instanceId or a releaseId' })

    const detail = await fetchReleaseDetail(releaseId)
    if (!detail || detail.missing) return res.status(404).json({ error: 'Release not found' })

    // The master release carries the original year, which decides where it sits
    // among the rest of that artist's records.
    if (detail.masterId && !store.getMaster(detail.masterId)) {
      try {
        const m = await api(`/masters/${detail.masterId}`, { priority: 0 })
        store.putMaster(detail.masterId, { id: detail.masterId, year: m?.year || null })
      } catch {}
    }

    const candidate = candidateFromRelease({
      id: detail.id,
      title: detail.title,
      artists: detail.artists,
      formats: detail.formats,
      genres: detail.genres,
      styles: detail.styles,
      year: detail.year,
      master_id: detail.masterId,
      labels: detail.labels,
      country: detail.country,
      images: detail.images?.map((i) => ({ uri150: i.thumb })),
      estimated_weight: detail.estimatedWeight,
    })

    const owned = store.collection.items.find((i) => i.releaseId === Number(releaseId))
    res.json({
      record: candidate,
      alreadyOwned: owned ? owned.instanceId : null,
      placement: placeRecord(candidate),
    })
  }),
)

/* ------------------------------------------------------------------ */
/* Artists — sort-name overrides                                       */
/* ------------------------------------------------------------------ */

router.post('/artists/sort-name', (req, res) => {
  const { artistKey: key, sortName } = req.body || {}
  if (!key) return res.status(400).json({ error: 'artistKey required' })
  if (!sortName) delete store.overrides.artists[key]
  else store.overrides.artists[key] = { sortName: String(sortName).trim() }
  store.save('overrides')
  res.json({ ok: true })
})

/** Everything currently filed by guesswork, so the user can audit it in one place. */
router.get('/artists/guesses', (req, res) => {
  const seen = new Map()
  for (const r of allRecords()) {
    if (seen.has(r.artistKey)) {
      seen.get(r.artistKey).count += 1
      continue
    }
    seen.set(r.artistKey, {
      artistKey: r.artistKey,
      artist: r.artistName,
      sortName: r.sortName,
      basis: r.sortBasis,
      type: r.artistType,
      count: 1,
    })
  }
  const list = [...seen.values()].sort((a, b) =>
    collationKey(a.sortName) < collationKey(b.sortName) ? -1 : 1,
  )
  res.json({ artists: list })
})

/* ------------------------------------------------------------------ */
/* Value estimate                                                      */
/* ------------------------------------------------------------------ */

router.post('/value/start', (req, res) => {
  priceEverything()
  res.json({ ok: true })
})

router.get('/value', (req, res) => {
  let total = 0
  let priced = 0
  for (const id of new Set(store.collection.items.map((i) => i.releaseId))) {
    const m = store.getMarket(id)
    const v = m?.stats?.lowest_price?.value
    if (typeof v === 'number') {
      total += v
      priced += 1
    }
  }
  res.json({ total, priced, currency: config.currency, progress: enrichState.market })
})

/* ------------------------------------------------------------------ */
/* Image proxy — caches Discogs art locally so the grid stays instant   */
/* ------------------------------------------------------------------ */

const IMG_DIR = path.join(DATA_DIR, 'images')
fs.mkdirSync(IMG_DIR, { recursive: true })

router.get(
  '/img',
  wrap(async (req, res) => {
    const url = String(req.query.u || '')
    if (!/^https:\/\/([a-z0-9-]+\.)?discogs\.com\//i.test(url)) {
      return res.status(400).end('Only Discogs images are proxied')
    }
    const hash = crypto.createHash('sha1').update(url).digest('hex')
    const ext = (url.match(/\.(jpe?g|png|gif|webp)(?:$|\?)/i) || [, 'jpg'])[1].toLowerCase()
    const file = path.join(IMG_DIR, `${hash}.${ext}`)

    if (fs.existsSync(file)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
      return res.sendFile(file)
    }

    const upstream = await fetch(url, { headers: { 'User-Agent': config.userAgent } })
    if (!upstream.ok) return res.status(upstream.status).end()
    const buf = Buffer.from(await upstream.arrayBuffer())
    fs.writeFileSync(file, buf)
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.end(buf)
  }),
)

router.use((err, req, res, next) => {
  const status = err.status || 500
  if (status === 401) store.clearAuth()
  res.status(status).json({ error: err.message })
})
