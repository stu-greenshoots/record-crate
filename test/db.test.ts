// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sql } from 'kysely'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createDb, migrateDown, migrateToLatest, type Db } from '../api/db'
import { seedFromSnapshot } from '../api/db/seed'
import type { RecordSummary } from '../contract'

/**
 * These run against a real Postgres: the one `npm run api:services` starts. Each run
 * gets a database of its own, dropped afterwards. With no Postgres they're skipped,
 * and say so.
 */
const ADMIN_URL = process.env.TEST_DATABASE_ADMIN_URL || 'postgres://crate:crate@localhost:5433/postgres'
const NAME = `crate_test_${process.pid}_${Date.now()}`

async function reachable() {
  const client = new pg.Client({ connectionString: ADMIN_URL, connectionTimeoutMillis: 1500 })
  try {
    await client.connect()
    return true
  } catch {
    return false
  } finally {
    await client.end().catch(() => {})
  }
}

const available = await reachable()
if (!available) console.warn('Skipping database tests: no Postgres at', ADMIN_URL, '(npm run api:services starts one)')

async function admin(query: string) {
  const client = new pg.Client({ connectionString: ADMIN_URL })
  await client.connect()
  try {
    await client.query(query)
  } finally {
    await client.end()
  }
}

let db: Db

beforeAll(async () => {
  if (!available) return
  await admin(`create database ${NAME}`)
  db = createDb(ADMIN_URL.replace(/\/[^/]*$/, `/${NAME}`), 4)
})

afterAll(async () => {
  if (!available) return
  await db.destroy()
  await admin(`drop database if exists ${NAME} with (force)`)
})

const tables = async () =>
  (
    await sql<{ tablename: string }>`select tablename from pg_tables where schemaname = 'public' order by 1`.execute(db)
  ).rows.map((r) => r.tablename)

const rec = (id: number, releaseId: number, people?: [number, number][]): RecordSummary => ({
  id,
  releaseId,
  title: `Album ${releaseId}`,
  artist: 'Lankum',
  credit: 'Lankum',
  sortName: 'Lankum',
  year: 2023,
  originalYear: 2023,
  shelf: 'main',
  width: 1,
  height: 12,
  format: 'LP',
  catno: `RT${releaseId}`,
  label: 'Rough Trade',
  genres: ['Folk, World, & Country'],
  styles: ['Folk'],
  addedAt: '2026-01-02T03:04:05-00:00',
  cover: null,
  remoteCover: null,
  masterId: releaseId + 1000,
  ...(people ? { people } : {}),
})

function snapshotDir(records: RecordSummary[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crate-seed-'))
  fs.mkdirSync(path.join(dir, 'data'))
  fs.mkdirSync(path.join(dir, 'pressings'))
  fs.mkdirSync(path.join(dir, 'artists'))
  fs.writeFileSync(
    path.join(dir, 'data/collection.json'),
    JSON.stringify({
      exportedAt: '2026-11-08T00:00:00Z',
      syncedAt: '2026-11-08T00:00:00Z',
      username: 'radie-fan',
      shelves: [{ id: 'main', name: 'Main Shelf' }],
      shelfMap: { cols: 1, rows: 1, capacity: 80, flowShelf: 'main', slots: [{ type: 'flow' }] },
      people: [
        ['Radie Peat', 'vocals'],
        ['Ian Lynch', 'pipes'],
      ],
      completeness: {},
      records,
    }),
  )
  fs.writeFileSync(
    path.join(dir, 'artists/1.json'),
    JSON.stringify({ discogsId: 1, mbid: null, name: 'Lankum', type: 'Group', members: [], bands: [], groups: [] }),
  )
  return dir
}

describe.skipIf(!available)('migrations', () => {
  it('build the whole schema from an empty database', async () => {
    expect(await migrateToLatest(db)).toEqual(['0001_initial'])
    expect(await tables()).toEqual(
      expect.arrayContaining(['users', 'discogs_accounts', 'releases', 'owned', 'wanted', 'user_state', 'applied_ops']),
    )
  })

  it('do nothing when already up to date', async () => {
    expect(await migrateToLatest(db)).toEqual([])
  })

  it('can be undone and redone', async () => {
    expect(await migrateDown(db)).toEqual(['0001_initial'])
    expect((await tables()).filter((t) => !t.startsWith('kysely_'))).toEqual([])
    expect(await migrateToLatest(db)).toEqual(['0001_initial'])
  })
})

describe.skipIf(!available)('the schema protects itself', () => {
  let userId: string

  beforeAll(async () => {
    await migrateToLatest(db)
    userId = (await db.insertInto('users').defaultValues().returning('id').executeTakeFirstOrThrow()).id
  })

  it('refuses a want that names both a release and a master', async () => {
    await expect(
      db.insertInto('wanted').values({ user_id: userId, kind: 'release', release_id: 1, master_id: 2 }).execute(),
    ).rejects.toThrow(/check constraint/)
  })

  it('refuses wanting the same album twice, but allows it again once removed', async () => {
    await db.insertInto('wanted').values({ user_id: userId, kind: 'master', master_id: 77 }).execute()
    await expect(db.insertInto('wanted').values({ user_id: userId, kind: 'master', master_id: 77 }).execute()).rejects.toThrow(
      /unique/,
    )
    await db.updateTable('wanted').set({ removed_at: new Date() }).where('master_id', '=', 77).execute()
    await db.insertInto('wanted').values({ user_id: userId, kind: 'master', master_id: 77 }).execute()
  })

  it('removes everything of a user who is deleted', async () => {
    await db.deleteFrom('users').where('id', '=', userId).execute()
    expect(await db.selectFrom('wanted').where('user_id', '=', userId).selectAll().execute()).toEqual([])
  })
})

describe.skipIf(!available)('seeding from a snapshot', () => {
  beforeAll(() => migrateToLatest(db))

  it("loads a snapshot as one user's collection", async () => {
    const dir = snapshotDir([rec(11, 101, [[0, 1]]), rec(12, 102), rec(13, 101, [[0, 1]])])
    const result = await seedFromSnapshot(db, dir)
    expect(result).toMatchObject({ username: 'radie-fan', owned: 3, releases: 2, artists: 1 })

    const owned = await db.selectFrom('owned').selectAll().where('user_id', '=', result.userId).execute()
    expect(owned.map((o) => Number(o.instance_id)).sort()).toEqual([11, 12, 13])

    const release = await db.selectFrom('releases').selectAll().where('discogs_id', '=', 101).executeTakeFirstOrThrow()
    expect(release.summary).toMatchObject({ releaseId: 101, title: 'Album 101', people: [['Radie Peat', 'vocals', 1]] })
    expect(release.summary).not.toHaveProperty('id')

    const account = await db.selectFrom('discogs_accounts').selectAll().executeTakeFirstOrThrow()
    expect(account).toMatchObject({ username: 'radie-fan', status: 'pending', token_enc: null })
  })

  it('brings the same user in line when run again, marking records that went as removed', async () => {
    const before = await db.selectFrom('owned').select(['instance_id', 'seq']).execute()
    const highest = Math.max(...before.map((o) => Number(o.seq)))

    const result = await seedFromSnapshot(db, snapshotDir([rec(11, 101), rec(14, 103)]))
    expect(await db.selectFrom('users').select('id').execute()).toHaveLength(1)

    const rows = await db
      .selectFrom('owned')
      .select(['instance_id', 'removed_at', 'seq'])
      .where('user_id', '=', result.userId)
      .orderBy('instance_id')
      .execute()
    const removed = rows.filter((r) => r.removed_at).map((r) => Number(r.instance_id))
    expect(removed).toEqual([12, 13])
    expect(rows.every((r) => Number(r.seq) > highest)).toBe(true)
  })

  it('keeps the user’s phone state when seeded again', async () => {
    const { user_id } = await db.selectFrom('user_state').select('user_id').executeTakeFirstOrThrow()
    await db
      .updateTable('user_state')
      .set({ state: JSON.stringify({ out: { 11: 1 } }), version: 5 })
      .where('user_id', '=', user_id)
      .execute()
    await seedFromSnapshot(db, snapshotDir([rec(11, 101)]))
    const state = await db.selectFrom('user_state').selectAll().executeTakeFirstOrThrow()
    expect(state.version).toBe('5')
  })

  const realSnapshot = path.resolve(__dirname, '../public/data/collection.json')
  it.skipIf(!fs.existsSync(realSnapshot))('loads the real collection', async () => {
    const result = await seedFromSnapshot(db, path.resolve(__dirname, '../public'))
    expect(result.owned).toBeGreaterThan(500)
    expect(result.details).toBeGreaterThan(result.releases * 0.8)
  })
})
