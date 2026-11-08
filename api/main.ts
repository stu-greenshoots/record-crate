import { Redis } from 'ioredis'
import { sql } from 'kysely'
import { buildApp } from './app'
import { loadConfig } from './config'
import { createDb, migrateToLatest } from './db'

const config = loadConfig()

const db = createDb(config.databaseUrl)
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
redis.on('error', () => {})

const app = buildApp(
  config,
  {
    checks: {
      db: async () => (await sql<{ ok: number }>`select 1 as ok`.execute(db)).rows[0]?.ok === 1,
      queue: async () => (await redis.ping()) === 'PONG',
    },
  },
  { level: config.logLevel },
)

let closing = false
async function shutdown(signal: string) {
  if (closing) return
  closing = true
  app.log.info({ signal }, 'shutting down')
  await app.close()
  await Promise.allSettled([db.destroy(), redis.quit()])
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

if (config.migrateOnStart) {
  const ran = await migrateToLatest(db)
  if (ran.length) app.log.info({ migrations: ran }, 'migrated')
}
await redis.connect().catch((err) => app.log.warn({ err }, 'redis not reachable yet'))
await app.listen({ host: config.host, port: config.port })
