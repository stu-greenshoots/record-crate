import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Rec, Shelf, ShelfMapConfig, Snapshot } from '../app/types'

const KEY = 'record-crate:v1'

const SHELVES: Shelf[] = [
  { id: 'main', name: 'Main Shelf' },
  { id: 'singles', name: 'Singles' },
]

const MAP: ShelfMapConfig = {
  cols: 2,
  rows: 1,
  capacity: 10,
  flowShelf: 'main',
  slots: [{ type: 'flow' }, { type: 'shelves', shelfIds: ['singles'] }],
}

const rec = (id: number, sortName: string, shelf = 'main'): Rec => ({
  id,
  releaseId: id * 10,
  title: `Album ${id}`,
  artist: sortName,
  credit: sortName,
  sortName,
  year: 1970,
  originalYear: 1970,
  shelf,
  width: 1,
  height: 12,
  format: 'LP',
  catno: `CAT ${id}`,
  label: 'Label',
  genres: ['Rock'],
  styles: [],
  addedAt: '2026-01-01',
  cover: null,
  remoteCover: null,
})

const SNAPSHOT: Snapshot = {
  exportedAt: '2026-11-01T00:00:00Z',
  syncedAt: '2026-11-01T00:00:00Z',
  username: 'tester',
  shelves: SHELVES,
  shelfMap: MAP,
  records: [rec(1, 'Abba'), rec(2, 'Beatles, The'), rec(3, 'Cave, Nick'), rec(4, 'Dylan, Bob'), rec(5, 'Seven', 'singles')],
}

/** A fresh copy of the store module, so its singletons start from what's in localStorage now. */
async function freshStore(snapshot: Snapshot | null = SNAPSHOT) {
  vi.resetModules()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      snapshot ? new Response(JSON.stringify(snapshot), { status: 200 }) : new Response('nope', { status: 500 }),
    ),
  )
  const store = await import('../app/store')
  await store.load()
  return store
}

const saved = () => JSON.parse(localStorage.getItem(KEY) || 'null')

beforeEach(() => localStorage.clear())
afterEach(() => vi.unstubAllGlobals())

describe('loading', () => {
  it('derives every record, filed into cubes, from the snapshot', async () => {
    const { getStore } = await freshStore()
    const s = getStore()!
    expect(s.records.map((r) => r.id)).toEqual([1, 2, 3, 4, 5])
    expect(s.built.slots[0].instanceIds).toEqual([1, 2, 3, 4])
    expect(s.built.slots[1].instanceIds).toEqual([5])
    expect(s.spots.get(3)).toMatchObject({ index: 2, before: { id: 2 }, after: { id: 4 } })
  })

  it('reports a failed load instead of throwing', async () => {
    const { getStore } = await freshStore(null)
    expect(getStore()).toBeNull()
  })

  it('fills fields missing from an older save with their defaults', async () => {
    localStorage.setItem(KEY, JSON.stringify({ version: 1, out: { 2: 5 } }))
    const { getStore } = await freshStore()
    const local = getStore()!.local
    expect(local.out).toEqual({ 2: 5 })
    expect(local.sorted).toEqual({})
    expect(local.runoutOf).toEqual({})
    expect(local.fresh).toEqual([])
  })

  it('starts empty when the save is not JSON', async () => {
    localStorage.setItem(KEY, '{not json')
    const { getStore } = await freshStore()
    expect(getStore()!.local.out).toEqual({})
  })
})

describe('update', () => {
  it('saves every change to localStorage and tells subscribers', async () => {
    const { takeOut, getStore } = await freshStore()
    takeOut(2)
    expect(Object.keys(saved().out)).toEqual(['2'])
    expect(getStore()!.out.map((r) => r.id)).toEqual([2])
  })

  it('never mutates the state a subscriber already holds', async () => {
    const { takeOut, getStore } = await freshStore()
    const before = getStore()!.local
    takeOut(2)
    expect(before.out).toEqual({})
    expect(getStore()!.local).not.toBe(before)
  })

  it('keeps working in memory when storage refuses the write', async () => {
    const { takeOut, getStore } = await freshStore()
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })
    takeOut(3)
    expect(getStore()!.out.map((r) => r.id)).toEqual([3])
    spy.mockRestore()
  })
})

describe('records out of the shelf', () => {
  it('lists them in the order you walk the unit, and skips them as landmarks', async () => {
    const { takeOut, getStore } = await freshStore()
    takeOut(5)
    takeOut(3)
    takeOut(2)
    const s = getStore()!
    expect(s.out.map((r) => r.id)).toEqual([2, 3, 5])
    expect(s.spots.get(3)).toMatchObject({ before: { id: 1 }, after: { id: 4 } })
  })

  it('put back clears it', async () => {
    const { takeOut, putBack, getStore } = await freshStore()
    takeOut(2)
    putBack(2)
    expect(getStore()!.out).toEqual([])
  })
})

describe('filing fixes', () => {
  it('files a record under a corrected name, and the original name clears the fix', async () => {
    const { setSortName, getStore } = await freshStore()
    setSortName([1], 'Zappa, Frank')
    expect(getStore()!.built.slots[0].instanceIds).toEqual([2, 3, 4, 1])
    setSortName([1], 'Abba')
    expect(saved().sortOf).toEqual({})
  })

  it('moves records to another shelf, and moving back clears the fix', async () => {
    const { moveManyToShelf, getStore } = await freshStore()
    moveManyToShelf([1, 2], 'singles')
    expect(getStore()!.built.slots[1].instanceIds).toEqual([1, 2, 5])
    moveManyToShelf([1, 2], 'main')
    expect(saved().shelfOf).toEqual({})
  })

  it('sends the records of a deleted shelf back to the A–Z run', async () => {
    const { deleteShelf, getStore } = await freshStore()
    deleteShelf('singles')
    const s = getStore()!
    expect(s.shelves.map((x) => x.id)).toEqual(['main'])
    expect(s.map.slots[1]).toEqual({ type: 'flow' })
    expect(s.records.find((r) => r.id === 5)!.shelf).toBe('main')
  })
})

describe('the organise pass', () => {
  it('ticks and unticks a record in a cube', async () => {
    const { toggleSorted, getStore } = await freshStore()
    toggleSorted(0, 3)
    expect(getStore()!.local.sorted).toEqual({ 0: [3] })
    toggleSorted(0, 3)
    expect(getStore()!.local.sorted).toEqual({ 0: [] })
  })

  it('a new layout clears the ticks, since they were for the old cubes', async () => {
    const { toggleSorted, setMap, getStore } = await freshStore()
    toggleSorted(0, 3)
    setMap({ ...MAP, capacity: 20 })
    expect(getStore()!.local.sorted).toEqual({})
    expect(getStore()!.local.mapBase).toBe(SNAPSHOT.exportedAt)
  })
})

describe('records added since the snapshot', () => {
  it('shows a fresh record once, even when the next snapshot has it too', async () => {
    localStorage.setItem(KEY, JSON.stringify({ fresh: [rec(2, 'Beatles, The'), rec(9, 'Waits, Tom')] }))
    const { getStore } = await freshStore()
    expect(getStore()!.records.map((r) => r.id)).toEqual([1, 2, 3, 4, 5, 9])
  })

  it('hides records gone from the collection', async () => {
    localStorage.setItem(KEY, JSON.stringify({ gone: [4] }))
    const { getStore } = await freshStore()
    expect(getStore()!.records.map((r) => r.id)).toEqual([1, 2, 3, 5])
  })
})

describe('backups', () => {
  it('restores a backup and hands back what it replaced', async () => {
    const { takeOut, backupText, restoreBackup, putBack, getStore } = await freshStore()
    takeOut(1)
    const text = backupText()
    putBack(1)
    takeOut(4)
    const replaced = restoreBackup(text)
    expect(Object.keys(replaced.out)).toEqual(['4'])
    expect(getStore()!.out.map((r) => r.id)).toEqual([1])
  })
})
