/**
 * A file holding everything saved on one phone, so it can be kept somewhere safe,
 * restored, or read on the laptop. The phone's own storage is the only copy otherwise.
 */

const KIND = 'record-crate-backup'
const VERSION = 1

export const EMPTY_LOCAL = {
  version: 1,
  out: {},
  recent: [],
  shelfOf: {},
  sortOf: {},
  shelves: null,
  map: null,
  mapBase: null,
  fresh: [],
  gone: [],
  sorted: {},
  runoutOf: {},
  lastCheck: null,
}

export function toBackup(local, snapshotExportedAt, now = new Date()) {
  return JSON.stringify(
    { kind: KIND, version: VERSION, savedAt: now.toISOString(), snapshot: snapshotExportedAt, local },
    null,
    1,
  )
}

const isMap = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** Throws, with a message fit to show, on anything that isn't a backup this app made. */
export function fromBackup(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new Error("That file isn't a Record Crate backup.")
  }
  if (!isMap(data) || data.kind !== KIND) throw new Error("That file isn't a Record Crate backup.")
  if (data.version !== VERSION) throw new Error(`That backup is version ${data.version}; this app reads version ${VERSION}.`)
  const local = { ...EMPTY_LOCAL, ...data.local }
  for (const key of ['out', 'shelfOf', 'sortOf', 'sorted']) {
    if (!isMap(local[key])) throw new Error(`That backup is damaged (${key}).`)
  }
  for (const key of ['recent', 'fresh', 'gone']) {
    if (!Array.isArray(local[key])) throw new Error(`That backup is damaged (${key}).`)
  }
  return { savedAt: data.savedAt, snapshot: data.snapshot, local }
}

/**
 * Fold a phone's edits into the laptop's overrides (data/overrides.json), so the next
 * snapshot carries them. Only what describes the shelf moves across: where records
 * live, the names they're filed under, the shelves and the unit. What's out, the
 * ticks and the recent list stay on the phone. Returns new overrides and a list of
 * changes; the input isn't touched.
 */
export function mergeIntoOverrides(overrides, local, now = Date.now()) {
  const next = structuredClone(overrides)
  const changes = []
  for (const [id, shelf] of Object.entries(local.shelfOf)) {
    const rec = next.records[id]
    if (!rec) {
      changes.push(`skip ${id}: not in the laptop's collection`)
      continue
    }
    if (rec.shelf === shelf) continue
    changes.push(`${id}: shelf ${rec.shelf} -> ${shelf}`)
    rec.shelf = shelf
    rec.movedAt = now
  }
  for (const [id, sortName] of Object.entries(local.sortOf)) {
    const rec = next.records[id]
    if (!rec) {
      changes.push(`skip ${id}: not in the laptop's collection`)
      continue
    }
    if (rec.sortName === sortName) continue
    changes.push(`${id}: filed under ${sortName}`)
    rec.sortName = sortName
  }
  if (local.shelves && JSON.stringify(local.shelves) !== JSON.stringify(next.shelves)) {
    changes.push(`shelves: ${local.shelves.map((s) => s.name).join(', ')}`)
    next.shelves = structuredClone(local.shelves)
  }
  if (local.map && JSON.stringify(local.map) !== JSON.stringify(next.shelfMap)) {
    changes.push(`unit: ${local.map.cols}x${local.map.rows}, ${local.map.split || 'even'} split`)
    next.shelfMap = structuredClone(local.map)
  }
  return { overrides: next, changes }
}
