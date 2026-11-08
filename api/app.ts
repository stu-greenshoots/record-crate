import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyServerOptions } from 'fastify'
import type { Config } from './config'
import { installErrors, serve } from './http'

/** A dependency the API needs to be useful: it answers true when it's reachable. */
export type Check = () => Promise<boolean>

export interface Deps {
  checks: { db: Check; queue: Check }
}

const REQUEST_ID = 'x-request-id'
const CHECK_TIMEOUT_MS = 2000

async function within(check: Check) {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(false), CHECK_TIMEOUT_MS)
  })
  try {
    return await Promise.race([check().catch(() => false), timeout])
  } finally {
    clearTimeout(timer)
  }
}

export function buildApp(config: Config, deps: Deps, logger: FastifyServerOptions['logger'] = false) {
  const app = Fastify({
    logger,
    genReqId: (req) => {
      const given = req.headers[REQUEST_ID]
      return typeof given === 'string' && /^[\w-]{8,64}$/.test(given) ? given : randomUUID()
    },
    bodyLimit: 1024 * 1024,
  })

  app.decorateRequest('caller', null)
  app.decorateRequest('admin', false)
  app.addHook('onRequest', async (request, reply) => {
    reply.header(REQUEST_ID, request.id)
  })
  installErrors(app)

  const options = { checkResponses: config.checkResponses }

  serve(
    app,
    'health',
    async ({ reply }) => {
      const [db, queue] = await Promise.all([within(deps.checks.db), within(deps.checks.queue)])
      const ok = db && queue
      if (!ok) reply.code(503)
      return { ok, db, queue }
    },
    options,
  )

  return app
}
