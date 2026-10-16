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
