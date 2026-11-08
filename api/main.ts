import { Redis } from 'ioredis'
import pg from 'pg'
import { buildApp } from './app'
import { loadConfig } from './config'

const config = loadConfig()

const db = new pg.Pool({ connectionString: config.databaseUrl, max: 10 })
const redis = new Redis(config.redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 })
redis.on('error', () => {})

const app = buildApp(
  config,
  {
    checks: {
      db: async () => (await db.query('select 1 as ok')).rows[0]?.ok === 1,
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
  await Promise.allSettled([db.end(), redis.quit()])
  process.exit(0)
}
process.on('SIGTERM', () => void shutdown('SIGTERM'))
process.on('SIGINT', () => void shutdown('SIGINT'))

await redis.connect().catch((err) => app.log.warn({ err }, 'redis not reachable yet'))
await app.listen({ host: config.host, port: config.port })
