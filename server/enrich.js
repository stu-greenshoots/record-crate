import { api } from './discogs.js'
import { store } from './store.js'
import { config } from './config.js'
import { cleanArtistName } from '../shared/classify.js'

/**
 * Background crawl that fills in everything the collection endpoint doesn't give us:
 * back-cover art, tracklists, credits and notes per release, and — crucially for
 * sorting — whether each artist is a person or a group.
 */
export const enrichState = {
  running: false,
  releases: { done: 0, total: 0 },
  artists: { done: 0, total: 0 },
  masters: { done: 0, total: 0 },
  market: { done: 0, total: 0, running: false },
  error: null,
}

function trimRelease(r) {
  return {
    id: r.id,
    masterId: r.master_id || null,
    title: r.title,
    year: r.year || null,
    released: r.released_formatted || r.released || null,
    country: r.country || null,
    notes: r.notes || null,
    dataQuality: r.data_quality || null,
    uri: r.uri || null,
    genres: r.genres || [],
    styles: r.styles || [],
    artists: (r.artists || []).map((a) => ({ id: a.id, name: a.name, anv: a.anv || null, join: a.join || '' })),
    labels: (r.labels || []).map((l) => ({ id: l.id, name: l.name, catno: l.catno })),
    formats: (r.formats || []).map((f) => ({
      name: f.name,
      qty: f.qty,
      text: f.text || null,
      descriptions: f.descriptions || [],
    })),
    images: (r.images || []).map((i) => ({
      type: i.type,
      uri: i.uri,
      thumb: i.uri150,
      width: i.width,
      height: i.height,
    })),
    tracklist: (r.tracklist || []).map((t) => ({
      position: t.position,
      title: t.title,
      duration: t.duration,
      type: t.type_,
      artists: (t.artists || []).map((a) => a.anv || a.name),
      credits: (t.extraartists || []).map((a) => ({ name: a.name, role: a.role })),
    })),
    credits: (r.extraartists || []).map((a) => ({ id: a.id, name: a.name, role: a.role })),
    companies: (r.companies || []).map((c) => ({ name: c.name, role: c.entity_type_name })),
    identifiers: (r.identifiers || []).slice(0, 12).map((i) => ({
      type: i.type,
      value: i.value,
      description: i.description || null,
    })),
    videos: (r.videos || []).slice(0, 8).map((v) => ({
      uri: v.uri,
      title: v.title,
      duration: v.duration,
    })),
    community: r.community
      ? {
          have: r.community.have,
          want: r.community.want,
          rating: r.community.rating || null,
        }
      : null,
    numForSale: r.num_for_sale ?? null,
    estimatedWeight: r.estimated_weight ?? null,
    lowestPrice: r.lowest_price ?? null,
    fetchedAt: Date.now(),
  }
}

function pendingReleaseIds() {
  const seen = new Set()
  const out = []
  for (const item of store.collection.items) {
    if (seen.has(item.releaseId)) continue
    seen.add(item.releaseId)
    if (!store.hasRelease(item.releaseId)) out.push(item.releaseId)
  }
  return out
}

function pendingArtistIds() {
  const out = new Map()
  for (const item of store.collection.items) {
    for (const a of item.info.artists || []) {
      if (!a.id || a.id === 194 /* Various */) continue
      if (store.getArtist(a.id)) continue
      out.set(a.id, cleanArtistName(a.name))
    }
  }
  return [...out.entries()]
}

/**
 * A Discogs artist with a `members` list is a group; one with a `realname` is a
 * person. Anything else stays unknown and falls back to the name-shape heuristic.
 */
function pendingMasterIds() {
  const out = new Set()
  for (const item of store.collection.items) {
    if (item.masterId && !store.getMaster(item.masterId)) out.add(item.masterId)
  }
  return [...out]
}

function artistTypeOf(a) {
  if (Array.isArray(a.members) && a.members.length) return 'group'
  if (a.realname && a.realname.trim()) return 'person'
  return null
}

/**
 * Fetch one release ahead of the background queue — used when the user opens a
 * record the crawl hasn't reached yet.
 */
export async function fetchReleaseDetail(releaseId, { force = false } = {}) {
  const cached = store.getRelease(releaseId)
  if (cached && !cached.missing && !force) return cached
  const raw = await api(`/releases/${releaseId}?curr_abbr=${encodeURIComponent(config.currency)}`, {
    priority: 0,
  })
  if (!raw) {
    const missing = { id: releaseId, missing: true, fetchedAt: Date.now() }
    store.putRelease(releaseId, missing)
    return missing
  }
  const trimmed = trimRelease(raw)
  store.putRelease(releaseId, trimmed)
  return trimmed
}

export async function fetchMarket(releaseId, { force = false } = {}) {
  const cached = store.getMarket(releaseId)
  const DAY = 24 * 60 * 60 * 1000
  if (!force && cached && Date.now() - cached.fetchedAt < DAY) return cached

  const result = { fetchedAt: Date.now(), stats: null, suggestions: null }
  try {
    result.stats = await api(
      `/marketplace/stats/${releaseId}?curr_abbr=${encodeURIComponent(config.currency)}`,
      { priority: 0 },
    )
  } catch {}
  try {
    result.suggestions = await api(`/marketplace/price_suggestions/${releaseId}`, { priority: 0 })
  } catch {}
  store.putMarket(releaseId, result)
  return result
}

let loopHandle = null

async function loop() {
  enrichState.running = true
  try {
    for (;;) {
      const releases = pendingReleaseIds()
      const artists = pendingArtistIds()
      const masters = pendingMasterIds()
      const totalReleases = new Set(store.collection.items.map((i) => i.releaseId)).size
      enrichState.releases = { done: totalReleases - releases.length, total: totalReleases }
      enrichState.artists = {
        done: Object.keys(store.artists).length,
        total: Object.keys(store.artists).length + artists.length,
      }

      const totalMasters = new Set(
        store.collection.items.map((i) => i.masterId).filter(Boolean),
      ).size
      enrichState.masters = { done: totalMasters - masters.length, total: totalMasters }

      if (!releases.length && !artists.length && !masters.length) break

      // Interleave so the two kinds of progress advance together.
      if (releases.length) {
        const id = releases[0]
        try {
          const r = await api(`/releases/${id}?curr_abbr=${encodeURIComponent(config.currency)}`)
          if (r) store.putRelease(id, trimRelease(r))
          else store.putRelease(id, { id, missing: true, fetchedAt: Date.now() })
        } catch (err) {
          if (err.status === 401) throw err
          store.putRelease(id, { id, missing: true, error: err.message, fetchedAt: Date.now() })
        }
      }

      if (masters.length) {
        // The master release carries the year the album first came out, which is
        // what an artist's records should be ordered by — not the year this
        // particular pressing happens to be from.
        const id = masters[0]
        try {
          const m = await api(`/masters/${id}`)
          store.putMaster(id, { id, year: m?.year || null, title: m?.title || null })
        } catch (err) {
          if (err.status === 401) throw err
          store.putMaster(id, { id, year: null, error: true })
        }
      }

      if (artists.length) {
        const [id, name] = artists[0]
        try {
          const a = await api(`/artists/${id}`)
          store.putArtist(id, {
            id,
            name: a?.name || name,
            type: a ? artistTypeOf(a) : null,
            realname: a?.realname || null,
            memberCount: Array.isArray(a?.members) ? a.members.length : 0,
          })
        } catch (err) {
          if (err.status === 401) throw err
          store.putArtist(id, { id, name, type: null, error: true })
        }
      }
    }
    enrichState.error = null
  } catch (err) {
    enrichState.error = err.message
  } finally {
    enrichState.running = false
    loopHandle = null
    store.flush('artists')
    store.flush('masters')
  }
}

export function startEnrichment() {
  if (loopHandle || !store.auth || !store.collection.items.length) return
  loopHandle = loop()
}

/** Opt-in second pass that prices the whole collection for the value estimate. */
export async function priceEverything() {
  if (enrichState.market.running) return
  enrichState.market.running = true
  try {
    const ids = [...new Set(store.collection.items.map((i) => i.releaseId))]
    enrichState.market = { done: 0, total: ids.length, running: true }
    for (const id of ids) {
      const cached = store.getMarket(id)
      if (!cached || Date.now() - cached.fetchedAt > 7 * 24 * 60 * 60 * 1000) {
        try {
          const stats = await api(
            `/marketplace/stats/${id}?curr_abbr=${encodeURIComponent(config.currency)}`,
          )
          store.putMarket(id, { fetchedAt: Date.now(), stats, suggestions: null })
        } catch {}
      }
      enrichState.market.done += 1
    }
  } finally {
    enrichState.market.running = false
    store.flush('market')
  }
}
