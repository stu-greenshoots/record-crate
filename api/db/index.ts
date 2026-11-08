import { Kysely, Migrator, PostgresDialect, type Migration, type MigrationResultSet } from 'kysely'
import pg from 'pg'
import * as initial from './migrations/0001_initial'
import type { Database } from './types'

export type Db = Kysely<Database>

/**
 * Migrations are listed here rather than read from a folder, so they travel inside the
 * bundled server. Names sort in the order they run; never rename or edit one that has
 * reached the VPS: add the next one.
 */
export const MIGRATIONS: Record<string, Migration> = {
  '0001_initial': initial,
}

export function createDb(connectionString: string, max = 10): Db {
  return new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString, max }) }),
  })
}

/** Typed loosely: migrations run against whatever schema exists, not the one in types.ts. */
export function migrator(db: Kysely<any>) {
  return new Migrator({ db, provider: { getMigrations: async () => MIGRATIONS } })
}

/** Bring the database up to date. Kysely holds a lock, so two servers starting at once is safe. */
export async function migrateToLatest(db: Kysely<any>) {
  return check(await migrator(db).migrateToLatest())
}

function check({ error, results }: MigrationResultSet) {
  const ran = (results || []).filter((r) => r.status === 'Success').map((r) => r.migrationName)
  if (error) {
    const failed = results?.find((r) => r.status === 'Error')?.migrationName
    throw new Error(`Migration ${failed || ''} failed: ${String((error as Error)?.message || error)}`, { cause: error })
  }
  return ran
}

export async function migrateDown(db: Kysely<any>) {
  return check(await migrator(db).migrateDown())
}
