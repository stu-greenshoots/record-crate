import { z } from 'zod'

const LOCAL = {
  DATABASE_URL: 'postgres://crate:crate@localhost:5433/crate',
  REDIS_URL: 'redis://localhost:6380',
}

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().default('0.0.0.0'),
    PORT: z.coerce.number().int().positive().default(8787),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
    DATABASE_URL: z.string().url().optional(),
    REDIS_URL: z.string().url().optional(),
  })
  .transform((env, ctx) => {
    const production = env.NODE_ENV === 'production'
    for (const key of ['DATABASE_URL', 'REDIS_URL'] as const) {
      if (production && !env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required in production' })
    }
    return {
      env: env.NODE_ENV,
      host: env.HOST,
      port: env.PORT,
      logLevel: env.LOG_LEVEL,
      databaseUrl: env.DATABASE_URL ?? LOCAL.DATABASE_URL,
      redisUrl: env.REDIS_URL ?? LOCAL.REDIS_URL,
      /** Check every response against the contract; off in production, where it would cost every request. */
      checkResponses: !production,
    }
  })

export type Config = z.output<typeof Env>

export function loadConfig(source: Record<string, string | undefined> = process.env): Config {
  const parsed = Env.safeParse(source)
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`)
    throw new Error(`Bad configuration:\n${lines.join('\n')}`)
  }
  return parsed.data
}
