import express from 'express'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { store } from './store.js'
import { getRequestToken, getAccessToken, authorizeUrlFor, api } from './discogs.js'
import { whoAmI } from './sync.js'
import { fetchReleaseDetail } from './enrich.js'
import { allRecords, sortRecords, buildRecord } from './records.js'
import { placeRecord, candidateFromRelease } from './place.js'
import { readBackCover, readRunout, pythonAvailable, catnoSimilarity } from './identify.js'
import { rankPressings } from '../shared/pressingMatch.js'

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

/* ------------------------------------------------------------------ */
/* Collection                                                          */
/* ------------------------------------------------------------------ */

router.get('/records', (req, res) => {
  const mode = req.query.sort || store.overrides.settings.sortMode || 'smart'
  const records = sortRecords(allRecords(), mode)
  const counts = {}
  for (const r of records) counts[r.shelf] = (counts[r.shelf] || 0) + 1
  res.json({ records, counts, sortMode: mode, syncedAt: store.collection.syncedAt })
})

/* ------------------------------------------------------------------ */
/* Reading the back of a sleeve                                        */
/* ------------------------------------------------------------------ */

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
 * Which pressing is it? Photos in, ranked candidates out.
 *
 * Photos arrive as JSON with base64 data, tagged by what they show: front, back,
 * label, or runout. The sleeve photos feed the existing reader (catalogue number,
 * search terms); the runout photo feeds the deadwax reader; the signals meet in
 * shared/pressingMatch.js against a Discogs shortlist. Base64-over-JSON rather
 * than multipart keeps the server dependency-free — at a handful of photos per
 * request the inflation is affordable.
 */
router.post(
  '/identify/pressing',
  express.json({ limit: '60mb' }),
  wrap(async (req, res) => {
    if (!pythonAvailable()) {
      return res.status(503).json({ error: 'The photo reader needs the Python environment' })
    }
    const photos = (req.body?.photos || []).filter((p) => p?.data && p?.type)
    if (!photos.length) {
      return res.status(400).json({ error: 'Send photos: [{ type: front|back|label|runout, data: base64 }]' })
    }

    const signals = { runouts: [], catno: null, year: null, country: null }
    const reads = []
    for (const photo of photos.slice(0, 6)) {
      const file = path.join(os.tmpdir(), `crate-read-${crypto.randomBytes(6).toString('hex')}.jpg`)
      fs.writeFileSync(file, Buffer.from(photo.data, 'base64'))
      try {
        if (photo.type === 'runout') {
          const read = await readRunout(file)
          signals.runouts.push(...(read.candidates || []).map((c) => c.value))
          reads.push({ type: 'runout', ...read })
        } else {
          const read = await readBackCover(file)
          if (!signals.catno && read.catalogueNumbers?.length) {
            signals.catno = read.catalogueNumbers[0].value
          }
          reads.push({ type: photo.type, ...read })
        }
      } finally {
        fs.rmSync(file, { force: true })
      }
    }

    // The shortlist: catalogue number first because it names the album precisely,
    // search terms (or caller-supplied artist/title) when no number survived.
    let shortlist = []
    if (signals.catno) {
      const params = new URLSearchParams({ type: 'release', format: 'Vinyl', per_page: '18', catno: signals.catno })
      const found = await api(`/database/search?${params}`, { priority: 0 })
      shortlist = summariseResults(found?.results || [])
    }
    const terms = req.body?.hints?.search
      || reads.find((r) => r.searchTerms)?.searchTerms
    if (!shortlist.length && terms) {
      const params = new URLSearchParams({ type: 'release', format: 'Vinyl', per_page: '12', q: terms })
      const found = await api(`/database/search?${params}`, { priority: 0 })
      shortlist = summariseResults(found?.results || [])
    }
    if (!shortlist.length) {
      return res.json({ reads, candidates: [], confidence: 'none',
        error: 'Nothing readable enough to search Discogs with — try a sharper photo of the sleeve or label' })
    }

    // The search result names releases; only the detail carries their matrix
    // etchings, so fetch details for the head of the list before ranking.
    const details = []
    for (const result of shortlist.slice(0, 8)) {
      const detail = await fetchReleaseDetail(result.releaseId)
      if (detail && !detail.missing) details.push({ ...result, ...detail })
    }

    const ranked = rankPressings(details, signals)
    res.json({
      reads,
      signals,
      confidence: ranked.confidence,
      candidates: ranked.candidates.slice(0, 8),
    })
  }),
)

/* ------------------------------------------------------------------ */
/* "Where does this go?"                                               */
/* ------------------------------------------------------------------ */

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

router.use((err, req, res, next) => {
  const status = err.status || 500
  if (status === 401) store.clearAuth()
  res.status(status).json({ error: err.message })
})
