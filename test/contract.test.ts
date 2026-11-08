import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  ApiError,
  ArtistPage,
  CollectionIndex,
  NewWant,
  RecordSummary,
  ReleaseDetail,
  StateOp,
  UserState,
  pathFor,
  routes,
  type RecordSummary as RecordSummaryT,
  type RequestOf,
  type ResponseOf,
  type UserState as UserStateT,
} from '../contract'
import type { Local } from '../app/store'
import type { Rec } from '../app/types'

const PUBLIC = path.resolve(__dirname, '../public')
const real = (file: string) => {
  const p = path.join(PUBLIC, file)
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null
}
const sample = (dir: string, n: number) => {
  const d = path.join(PUBLIC, dir)
  if (!fs.existsSync(d)) return []
  return fs
    .readdirSync(d)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .slice(0, n)
    .map((f) => [f, JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'))] as const)
}

const at = '2026-11-08T12:00:00Z'

describe('the contract matches the data the app uses today', () => {
  const collection = real('data/collection.json')

  it.skipIf(!collection)('every record in the real snapshot is a valid RecordSummary', () => {
    const bad = collection.records
      .map((r: unknown) => RecordSummary.safeParse(r))
      .filter((r: { success: boolean }) => !r.success)
    expect(bad.map((r: { error: { issues: unknown } }) => r.error.issues).slice(0, 3)).toEqual([])
  })

  it.skipIf(!collection)('the real snapshot is a valid collection index once it has a cursor', () => {
    const result = CollectionIndex.safeParse({ ...collection, cursor: 'c1' })
    expect(result.success ? [] : result.error.issues.slice(0, 3)).toEqual([])
  })

  it('real pressing files are valid release details', () => {
    for (const [file, data] of sample('pressings', 60)) {
      const result = ReleaseDetail.safeParse(data)
      expect(result.success ? [] : [file, result.error.issues.slice(0, 2)]).toEqual([])
    }
  })

  it('real artist pages are valid', () => {
    for (const [file, data] of sample('artists', 60)) {
      const result = ArtistPage.safeParse(data)
      expect(result.success ? [] : [file, result.error.issues.slice(0, 2)]).toEqual([])
    }
  })

  it("a RecordSummary and the app's Rec are interchangeable", () => {
    expectTypeOf<RecordSummaryT>().toMatchTypeOf<Rec>()
    expectTypeOf<Rec>().toMatchTypeOf<RecordSummaryT>()
  })

  it("the server's state is the phone's saved state, less what the server now owns", () => {
    expectTypeOf<Omit<Local, 'version' | 'fresh' | 'gone' | 'mapBase' | 'lastCheck'>>().toMatchTypeOf<UserStateT>()
  })
})

describe('state operations', () => {
  it('accepts each kind of operation', () => {
    const ops = [
      { op: 'takeOut', opId: 'op-000001', at, id: 12 },
      { op: 'putBack', opId: 'op-000002', at, id: 12 },
      { op: 'setSortName', opId: 'op-000003', at, ids: [1, 2], sortName: 'Dylan, Bob' },
      { op: 'moveToShelf', opId: 'op-000004', at, ids: [3], shelf: 'singles' },
      { op: 'setMap', opId: 'op-000005', at, map: null },
      { op: 'setSorted', opId: 'op-000006', at, cube: 0, id: 4, sorted: true },
      { op: 'setRunout', opId: 'op-000007', at, id: 4, variant: null },
    ]
    for (const o of ops) expect(StateOp.safeParse(o).success, o.op).toBe(true)
  })

  it('has no toggles, so replaying an operation is harmless', () => {
    expect(StateOp.safeParse({ op: 'toggleSorted', opId: 'op-000008', at, cube: 0, id: 4 }).success).toBe(false)
    expect(StateOp.safeParse({ op: 'setSorted', opId: 'op-000009', at, cube: 0, id: 4 }).success).toBe(false)
  })

  it('needs an id to apply each operation once', () => {
    expect(StateOp.safeParse({ op: 'putBack', at, id: 1 }).success).toBe(false)
  })

  it('an empty state is valid', () => {
    const empty = { out: {}, recent: [], shelfOf: {}, sortOf: {}, shelves: null, map: null, sorted: {}, runoutOf: {} }
    expect(UserState.parse(empty)).toEqual(empty)
  })
})

describe('routes', () => {
  it('every route has a unique method and path', () => {
    const keys = Object.values(routes).map((r) => `${r.method} ${r.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('every route lives under /api', () => {
    for (const r of Object.values(routes)) expect(r.path.startsWith('/api/')).toBe(true)
  })

  it('every path parameter has a schema', () => {
    for (const [name, r] of Object.entries(routes)) {
      const names = [...r.path.matchAll(/:(\w+)/g)].map((m) => m[1])
      if (!names.length) continue
      expect('params' in r, name).toBe(true)
      const shape = (r as { params: { shape: Record<string, unknown> } }).params.shape
      expect(Object.keys(shape).sort(), name).toEqual(names.sort())
    }
  })

  it('the admin overview is only for the admin', () => {
    expect(routes.adminOverview.access).toBe('admin')
    const admin = Object.entries(routes).filter(([, r]) => r.access === 'admin')
    expect(admin.every(([, r]) => r.path.startsWith('/api/admin/'))).toBe(true)
  })

  it('coerces path parameters from the URL', () => {
    expect(routes.release.params.parse({ releaseId: '1005991' })).toEqual({ releaseId: 1005991 })
  })

  it('fills path parameters, and refuses to guess a missing one', () => {
    expect(pathFor(routes.release.path, { releaseId: 42 })).toBe('/api/releases/42')
    expect(pathFor(routes.removeWant.path, { wantId: 'a/b' })).toBe('/api/wants/a%2Fb')
    expect(() => pathFor(routes.release.path)).toThrow(/releaseId/)
  })

  it('only lets sign-in send you back to a path on this site', () => {
    expect(routes.discogsStart.query.safeParse({ next: '/unit' }).success).toBe(true)
    expect(routes.discogsStart.query.safeParse({ next: 'https://evil.example' }).success).toBe(false)
  })

  it('types requests and responses from the table', () => {
    expectTypeOf<RequestOf<'applyState'>['body']>().toMatchTypeOf<{ ops: unknown[] }>()
    expectTypeOf<ResponseOf<'me'>>().toHaveProperty('username')
    expectTypeOf<ResponseOf<'logout'>>().toBeUndefined()
  })
})

describe('wants and errors', () => {
  it('wants one pressing or any copy of an album', () => {
    expect(NewWant.safeParse({ target: { kind: 'release', releaseId: 1 } }).success).toBe(true)
    expect(NewWant.safeParse({ target: { kind: 'master', masterId: 2 } }).success).toBe(true)
    expect(NewWant.safeParse({ target: { kind: 'master', releaseId: 2 } }).success).toBe(false)
  })

  it('errors carry a known code', () => {
    expect(ApiError.safeParse({ error: { code: 'resync', message: 'Load the collection again' } }).success).toBe(true)
    expect(ApiError.safeParse({ error: { code: 'teapot', message: '' } }).success).toBe(false)
  })
})
