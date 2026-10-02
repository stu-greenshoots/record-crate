import { api } from './discogs.js'
import { store } from './store.js'
import { classifyShelf } from './classify.js'

export const syncState = {
  running: false,
  page: 0,
  pages: 0,
  fetched: 0,
  total: 0,
  error: null,
  finishedAt: null,
}

function joinArtists(artists) {
  if (!artists || !artists.length) return ''
  return artists
    .map((a, i) => {
      const name = a.anv || a.name
      const join = a.join && i < artists.length - 1 ? ` ${a.join} ` : ''
      return name + (join || (i < artists.length - 1 ? ' / ' : ''))
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Keep only the fields the UI needs — the raw payload is roughly 5x larger. */
function trimItem(item) {
  const b = item.basic_information || {}
  return {
    instanceId: item.instance_id,
    releaseId: b.id,
    masterId: b.master_id || null,
    folderId: item.folder_id,
    addedAt: item.date_added,
    rating: item.rating || 0,
    info: {
      title: b.title,
      artist: joinArtists(b.artists) || (b.artists && b.artists[0] && b.artists[0].name) || '',
      artists: (b.artists || []).map((a) => ({ id: a.id, name: a.name, anv: a.anv || null })),
      year: b.year || null,
      thumb: b.thumb || '',
      cover: b.cover_image || b.thumb || '',
      formats: (b.formats || []).map((f) => ({
        name: f.name,
        qty: f.qty,
        text: f.text || null,
        descriptions: f.descriptions || [],
      })),
      labels: (b.labels || []).map((l) => ({ name: l.name, catno: l.catno, id: l.id })),
      genres: b.genres || [],
      styles: b.styles || [],
    },
  }
}

export async function whoAmI() {
  const identity = await api('/oauth/identity', { priority: 0 })
  const profile = await api(`/users/${encodeURIComponent(identity.username)}`, { priority: 0 })
  return {
    id: identity.id,
    username: identity.username,
    name: profile?.name || identity.username,
    avatar: profile?.avatar_url || '',
    collectionCount: profile?.num_collection ?? null,
    profileUrl: profile?.uri || `https://www.discogs.com/user/${identity.username}`,
  }
}

/**
 * Pull the whole collection (folder 0 = "All") and merge it into the local store,
 * preserving any shelf/order edits already made against records we've seen before.
 */
export async function syncCollection() {
  if (syncState.running) return syncState
  syncState.running = true
  syncState.error = null
  syncState.fetched = 0
  syncState.page = 0
  syncState.pages = 0

  try {
    const username = store.auth.username
    const items = []
    let url = `/users/${encodeURIComponent(username)}/collection/folders/0/releases?per_page=100&page=1&sort=artist&sort_order=asc`

    while (url) {
      const page = await api(url, { priority: 0 })
      if (!page) break
      syncState.pages = page.pagination?.pages || 1
      syncState.page = page.pagination?.page || 1
      syncState.total = page.pagination?.items || 0
      for (const raw of page.releases || []) items.push(trimItem(raw))
      syncState.fetched = items.length
      url = page.pagination?.urls?.next || null
    }

    const overrides = store.overrides
    const knownShelves = new Set(overrides.shelves.map((s) => s.id))
    let added = 0

    for (const item of items) {
      const key = String(item.instanceId)
      const existing = overrides.records[key]
      if (!existing) {
        const shelf = classifyShelf({ ...item.info, artist: item.info.artist })
        overrides.records[key] = {
          shelf: knownShelves.has(shelf) ? shelf : 'main',
          position: null,
          autoShelf: shelf,
          addedToShelfAt: Date.now(),
        }
        added += 1
      } else if (!knownShelves.has(existing.shelf)) {
        // The shelf was deleted while we weren't looking.
        existing.shelf = 'main'
      }
    }

    // Drop bookkeeping for records no longer in the Discogs collection.
    const live = new Set(items.map((i) => String(i.instanceId)))
    for (const key of Object.keys(overrides.records)) {
      if (!live.has(key)) delete overrides.records[key]
    }

    store.collection = { syncedAt: new Date().toISOString(), username, items }
    store.flush('collection')
    store.flush('overrides')

    syncState.finishedAt = new Date().toISOString()
    syncState.added = added
    return syncState
  } catch (err) {
    syncState.error = err.message
    throw err
  } finally {
    syncState.running = false
  }
}
