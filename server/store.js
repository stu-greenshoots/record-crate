import fs from 'node:fs'
import path from 'node:path'
import { DATA_DIR } from './config.js'
import { DEFAULT_MAP } from '../shared/shelfmap.js'

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** Write via a temp file + rename so a crash mid-write can never truncate the store. */
function writeJson(file, value) {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2))
  fs.renameSync(tmp, file)
}

const paths = {
  auth: path.join(DATA_DIR, 'auth.json'),
  collection: path.join(DATA_DIR, 'collection.json'),
  overrides: path.join(DATA_DIR, 'overrides.json'),
  artists: path.join(DATA_DIR, 'artists.json'),
  masters: path.join(DATA_DIR, 'masters.json'),
  market: path.join(DATA_DIR, 'market.json'),
  release: (id) => path.join(DATA_DIR, 'releases', `${id}.json`),
}

export const DEFAULT_SHELVES = [
  { id: 'main', name: 'Main Shelf', hint: 'Everything that lives in the run' },
  { id: 'screen', name: 'Screen & Play', hint: 'Soundtracks, scores and game music' },
  { id: 'comps', name: 'Compilations', hint: 'Various artists and collections' },
  { id: 'metal', name: 'Heavy Rotation', hint: 'The heavy stuff' },
  { id: 'singles', name: 'Singles', hint: "7\"s, 10\"s and maxi-singles" },
]

class Store {
  constructor() {
    this.auth = readJson(paths.auth, null)
    this.collection = readJson(paths.collection, { syncedAt: null, username: null, items: [] })
    this.overrides = readJson(paths.overrides, null) || {
      shelves: DEFAULT_SHELVES.map((s) => ({ ...s })),
      records: {},
      artists: {},
      settings: { sortMode: 'smart', view: 'grid' },
    }
    if (!this.overrides.settings) this.overrides.settings = { sortMode: 'smart', view: 'grid' }
    if (!this.overrides.shelfMap) this.overrides.shelfMap = structuredClone(DEFAULT_MAP)
    this.artists = readJson(paths.artists, {})
    this.masters = readJson(paths.masters, {})
    this.market = readJson(paths.market, {})
    this.releaseCache = new Map()
    this.pending = new Set()
  }

  /** Coalesce rapid writes (drag-reorder fires many) into one flush per tick. */
  save(which) {
    if (this.pending.has(which)) return
    this.pending.add(which)
    setTimeout(() => {
      this.pending.delete(which)
      this.flush(which)
    }, 250)
  }

  flush(which) {
    if (which === 'auth') writeJson(paths.auth, this.auth)
    if (which === 'collection') writeJson(paths.collection, this.collection)
    if (which === 'overrides') writeJson(paths.overrides, this.overrides)
    if (which === 'artists') writeJson(paths.artists, this.artists)
    if (which === 'masters') writeJson(paths.masters, this.masters)
    if (which === 'market') writeJson(paths.market, this.market)
  }

  setAuth(auth) {
    this.auth = auth
    this.flush('auth')
  }

  clearAuth() {
    this.auth = null
    try {
      fs.unlinkSync(paths.auth)
    } catch {}
  }

  getRelease(id) {
    if (this.releaseCache.has(id)) return this.releaseCache.get(id)
    const value = readJson(paths.release(id), null)
    if (value) this.releaseCache.set(id, value)
    return value
  }

  hasRelease(id) {
    return this.releaseCache.has(id) || fs.existsSync(paths.release(id))
  }

  putRelease(id, value) {
    this.releaseCache.set(id, value)
    writeJson(paths.release(id), value)
  }

  getArtist(id) {
    return this.artists[id] || null
  }

  putArtist(id, value) {
    this.artists[id] = value
    this.save('artists')
  }

  getMaster(id) {
    return this.masters[id] || null
  }

  putMaster(id, value) {
    this.masters[id] = value
    this.save('masters')
  }

  getMarket(id) {
    return this.market[id] || null
  }

  putMarket(id, value) {
    this.market[id] = value
    this.save('market')
  }
}

export const store = new Store()
