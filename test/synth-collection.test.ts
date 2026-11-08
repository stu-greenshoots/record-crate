import { describe, expect, it } from 'vitest'
import { ID_BASE, synthesize } from '../scripts/synth-collection.mjs'
import { buildShelfMap } from '../shared/shelfmap.js'
import type { BuiltMap, Rec, Snapshot } from '../app/types'

const rec = (id: number, sortName: string, shelf: string, extra: Partial<Rec> = {}): Rec => ({
  id,
  releaseId: id * 10,
  title: `Album ${id}`,
  artist: sortName,
  credit: sortName,
  sortName,
  year: 1972,
  originalYear: 1970,
  shelf,
  width: 1,
  height: 1,
  format: 'LP',
  catno: `CAT ${id}`,
  label: 'Label',
  genres: ['Rock'],
  styles: ['Prog Rock'],
  addedAt: '2020-01-01T00:00:00Z',
  cover: `covers/${id}.jpg`,
  remoteCover: null,
  people: [[0, 1]],
  colour: 'rgb(1,2,3)',
  faces: [{ side: 'A' }, { side: 'B' }],
  ...extra,
})

const BASE: Snapshot = {
  exportedAt: '2026-11-01T00:00:00Z',
  syncedAt: '2026-11-01T00:00:00Z',
  username: 'tester',
  shelves: [
    { id: 'main', name: 'Main' },
    { id: 'metal', name: 'Heavy' },
    { id: 'singles', name: 'Singles' },
  ],
  shelfMap: {
    cols: 3,
    rows: 1,
    capacity: 20,
    flowShelf: 'main',
    split: 'letters',
    slots: [{ type: 'flow', from: 'A' }, { type: 'shelves', shelfIds: ['metal'] }, { type: 'shelves', shelfIds: ['singles'] }],
  },
  people: [
    ['Someone', 'drums'],
    ['Someone Else', 'producer'],
  ],
  completeness: { 1: [2, 5, 0, 1] },
  records: [
    rec(1, 'Abba', 'main'),
    rec(2, 'Abba', 'main'),
    rec(3, 'Beatles, The', 'main', { width: 1.85 }),
    rec(4, 'Cave, Nick', 'main', { genres: ['Pop'] }),
    rec(5, 'Zappa, Frank', 'main', { year: null, originalYear: null }),
    rec(6, '10cc', 'main'),
    rec(7, 'Sabbath', 'metal', { genres: ['Metal'] }),
    rec(8, 'Seven', 'singles', { height: 0.57, inches: 7, width: 0.3 }),
  ],
}

const nullable = (t: string) => (v: unknown) => v === null || typeof v === t
const REC: Record<string, (v: unknown) => boolean> = {
  id: Number.isSafeInteger,
  releaseId: Number.isSafeInteger,
  title: (v) => typeof v === 'string' && v.length > 0,
  artist: (v) => typeof v === 'string' && v.length > 0,
  credit: (v) => typeof v === 'string',
  sortName: (v) => typeof v === 'string' && v.length > 0,
  year: nullable('number'),
  originalYear: nullable('number'),
  shelf: (v) => typeof v === 'string',
  width: (v) => typeof v === 'number' && v > 0,
  height: (v) => typeof v === 'number' && v > 0,
  format: (v) => typeof v === 'string',
  catno: (v) => typeof v === 'string',
  label: (v) => typeof v === 'string',
  genres: (v) => Array.isArray(v) && v.every((g) => typeof g === 'string'),
  styles: (v) => Array.isArray(v) && v.every((g) => typeof g === 'string'),
  addedAt: (v) => typeof v === 'string' && !Number.isNaN(Date.parse(v)),
  cover: nullable('string'),
  remoteCover: nullable('string'),
}

describe('the synthetic collection', () => {
  const snap = synthesize(BASE, 400, 3) as Snapshot

  it('is the same every time for a seed, and different for another', () => {
    expect(synthesize(BASE, 400, 3)).toEqual(snap)
    expect(synthesize(BASE, 400, 4)).not.toEqual(snap)
  })

  it('has exactly n records, with ids of its own', () => {
    expect(snap.records).toHaveLength(400)
    const ids = snap.records.map((r) => r.id)
    expect(new Set(ids).size).toBe(400)
    expect(new Set(snap.records.map((r) => r.releaseId)).size).toBe(400)
    const real = new Set(BASE.records.map((r) => r.id))
    expect(ids.some((id) => real.has(id) || id < ID_BASE)).toBe(false)
  })

  it('is shaped like a snapshot', () => {
    expect(Object.keys(snap).sort()).toEqual(Object.keys(BASE).sort())
    const shelves = new Set(snap.shelves.map((s) => s.id))
    for (const r of snap.records) {
      for (const [key, ok] of Object.entries(REC)) expect(ok(r[key as keyof Rec]), `${key} of ${r.id}`).toBe(true)
      expect(shelves.has(r.shelf)).toBe(true)
      for (const [person] of r.people || []) expect(snap.people![person]).toBeDefined()
    }
  })

  it('gives artists several records and files them across the alphabet', () => {
    const names = new Set(snap.records.map((r) => r.sortName))
    expect(names.size).toBeLessThan(snap.records.length)
    expect(names.size).toBeGreaterThan(50)
    const letters = new Set([...names].map((n) => n[0]))
    expect(letters.size).toBeGreaterThan(3)
  })

  it('has a unit big enough to file every record', () => {
    const map = snap.shelfMap
    expect(map.slots).toHaveLength(map.cols * map.rows)
    const built = buildShelfMap(map, snap.records.map((r) => ({ ...r, instanceId: r.id })), snap.shelves) as unknown as BuiltMap
    expect(built.unplaced).toEqual([])
    expect(built.slots.filter((c) => c.type === 'flow' && c.over)).toEqual([])
  })
})
