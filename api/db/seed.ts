import fs from 'node:fs'
import path from 'node:path'
import { sql } from 'kysely'
import { ArtistPage, CollectionIndex, ReleaseDetail, type RecordSummary, type UserState } from '../../contract'
import type { Db } from './index'
import type { ReleaseSummary } from './types'

export const EMPTY_STATE: UserState = {
  out: {},
  recent: [],
  shelfOf: {},
  sortOf: {},
  shelves: null,
  map: null,
  sorted: {},
  runoutOf: {},
}

const CHUNK = 500

function chunks<T>(list: T[]) {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK))
  return out
}

function readJson(file: string) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
}

/** A snapshot record as its release's shared row: people by name, not by index. */
export function toReleaseSummary(r: RecordSummary, people: [string, string][]): ReleaseSummary {
  const { id: _id, addedAt: _addedAt, people: refs, ...rest } = r
  return {
    ...rest,
    ...(refs ? { people: refs.map(([i, kinds]) => [people[i][0], people[i][1], kinds] as [string, string, number]) } : {}),
  }
}

/**
 * Load a built snapshot (public/data/collection.json, plus the pressing and artist
 * files beside it) as one user's collection. Safe to run again: the user's records
 * are brought in line with the snapshot, and records no longer in it are marked removed.
 */
export async function seedFromSnapshot(db: Db, publicDir: string) {
  const snapshot = CollectionIndex.parse({
    cursor: '',
    ...readJson(path.join(publicDir, 'data/collection.json')),
  })
  const records = snapshot.records
  const releaseIds = [...new Set(records.map((r) => r.releaseId))]

  const details = new Map<number, unknown>()
  for (const id of releaseIds) {
    const detail = readJson(path.join(publicDir, 'pressings', `${id}.json`))
    if (detail && ReleaseDetail.safeParse(detail).success) details.set(id, detail)
  }

  const artistsDir = path.join(publicDir, 'artists')
  const artists = fs.existsSync(artistsDir)
    ? fs
        .readdirSync(artistsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ArtistPage.safeParse(readJson(path.join(artistsDir, f))))
        .filter((p) => p.success && p.data.discogsId)
        .map((p) => p.data!)
    : []

  return db.transaction().execute(async (tx) => {
    const account = await tx
      .selectFrom('discogs_accounts')
      .select('user_id')
      .where('username', '=', snapshot.username)
      .executeTakeFirst()
    let userId = account?.user_id
    if (!userId) {
      userId = (await tx.insertInto('users').defaultValues().returning('id').executeTakeFirstOrThrow()).id
      await tx.insertInto('discogs_accounts').values({ user_id: userId, username: snapshot.username }).execute()
    }

    const byRelease = new Map(records.map((r) => [r.releaseId, r]))
    for (const ids of chunks(releaseIds)) {
      await tx
        .insertInto('releases')
        .values(
          ids.map((id) => {
            const r = byRelease.get(id)!
            const detail = details.get(id)
            return {
              discogs_id: id,
              master_id: r.masterId ?? null,
              title: r.title,
              year: r.year,
              summary: JSON.stringify(toReleaseSummary(r, snapshot.people)),
              detail: detail ? JSON.stringify(detail) : null,
              built_at: new Date(),
            }
          }),
        )
        .onConflict((oc) =>
          oc.column('discogs_id').doUpdateSet((eb) => ({
            master_id: eb.ref('excluded.master_id'),
            title: eb.ref('excluded.title'),
            year: eb.ref('excluded.year'),
            summary: eb.ref('excluded.summary'),
            detail: sql`coalesce(excluded.detail, releases.detail)`,
            built_at: eb.ref('excluded.built_at'),
          })),
        )
        .execute()
    }

    for (const batch of chunks(records)) {
      await tx
        .insertInto('owned')
        .values(batch.map((r) => ({ user_id: userId, instance_id: r.id, release_id: r.releaseId, added_at: r.addedAt })))
        .onConflict((oc) =>
          oc.columns(['user_id', 'instance_id']).doUpdateSet({
            release_id: (eb) => eb.ref('excluded.release_id'),
            added_at: (eb) => eb.ref('excluded.added_at'),
            removed_at: null,
            seq: sql`nextval('collection_seq')`,
          }),
        )
        .execute()
    }
    let gone = tx
      .updateTable('owned')
      .set({ removed_at: new Date(), seq: sql`nextval('collection_seq')` })
      .where('user_id', '=', userId)
      .where('removed_at', 'is', null)
    if (records.length) gone = gone.where('instance_id', 'not in', records.map((r) => r.id))
    await gone.execute()

    for (const batch of chunks(artists)) {
      await tx
        .insertInto('artists')
        .values(batch.map((a) => ({ discogs_id: a.discogsId!, name: a.name, mbid: a.mbid, page: JSON.stringify(a) })))
        .onConflict((oc) =>
          oc.column('discogs_id').doUpdateSet((eb) => ({
            name: eb.ref('excluded.name'),
            mbid: eb.ref('excluded.mbid'),
            page: eb.ref('excluded.page'),
            fetched_at: new Date(),
          })),
        )
        .execute()
    }

    await tx
      .insertInto('user_settings')
      .values({ user_id: userId, shelves: JSON.stringify(snapshot.shelves), shelf_map: JSON.stringify(snapshot.shelfMap) })
      .onConflict((oc) =>
        oc.column('user_id').doUpdateSet((eb) => ({
          shelves: eb.ref('excluded.shelves'),
          shelf_map: eb.ref('excluded.shelf_map'),
          updated_at: new Date(),
        })),
      )
      .execute()

    await tx
      .insertInto('user_state')
      .values({ user_id: userId, state: JSON.stringify(EMPTY_STATE) })
      .onConflict((oc) => oc.column('user_id').doNothing())
      .execute()

    return {
      userId,
      username: snapshot.username,
      owned: records.length,
      releases: releaseIds.length,
      details: details.size,
      artists: artists.length,
    }
  })
}
