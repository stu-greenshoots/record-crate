import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { ZodError, type ZodTypeAny } from 'zod'
import { routes, type ErrorCode, type RequestOf, type ResponseOf, type RouteName } from '../contract'

const STATUS: Record<ErrorCode, number> = {
  unauthenticated: 401,
  forbidden: 403,
  'not-found': 404,
  invalid: 400,
  conflict: 409,
  resync: 410,
  'rate-limited': 429,
  upstream: 502,
  internal: 500,
}

export class HttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly extra: { retryAfter?: number; issues?: { path: string; message: string }[] } = {},
  ) {
    super(message)
  }

  get status() {
    return STATUS[this.code]
  }
}

const issuesOf = (err: ZodError, prefix: string) =>
  err.issues.map((i) => ({ path: [prefix, ...i.path].join('.'), message: i.message }))

function parse(schema: ZodTypeAny | undefined, value: unknown, part: string) {
  if (!schema) return undefined
  const result = schema.safeParse(value ?? {})
  if (!result.success) throw new HttpError('invalid', `Invalid ${part}`, { issues: issuesOf(result.error, part) })
  return result.data
}

export interface Caller {
  userId: string
}

declare module 'fastify' {
  interface FastifyRequest {
    /** The signed-in user, once sign-in exists. */
    caller: Caller | null
    admin: boolean
  }
}

export type Handler<N extends RouteName> = (
  input: RequestOf<N> & { caller: Caller | null; request: FastifyRequest; reply: FastifyReply },
) => Promise<ResponseOf<N>> | ResponseOf<N>

/**
 * Serve one route from the contract: its method, path and access rule come from the
 * table, its params, query and body are checked against the table's schemas, and
 * (outside production) so is what the handler sends back.
 */
export function serve<N extends RouteName>(
  app: FastifyInstance,
  name: N,
  handler: Handler<N>,
  options: { checkResponses: boolean },
) {
  const route = routes[name]
  app.route({
    method: route.method,
    url: route.path,
    handler: async (request, reply) => {
      if (route.access === 'user' && !request.caller) throw new HttpError('unauthenticated', 'Sign in first')
      if (route.access === 'admin' && !request.admin) throw new HttpError('unauthenticated', 'Admin sign-in needed')
      const input = {
        params: parse('params' in route ? route.params : undefined, request.params, 'params'),
        query: parse('query' in route ? route.query : undefined, request.query, 'query'),
        body: parse('body' in route ? route.body : undefined, request.body, 'body'),
      } as RequestOf<N>
      const result = await handler({ ...input, caller: request.caller, request, reply })
      if (route.response === null) {
        if (!reply.sent) reply.code(reply.statusCode === 200 ? 204 : reply.statusCode).send()
        return reply
      }
      if (options.checkResponses) {
        const checked = (route.response as ZodTypeAny).safeParse(result)
        if (!checked.success) {
          request.log.error({ issues: checked.error.issues, route: name }, 'response does not match the contract')
          throw new HttpError('internal', 'The server sent something it promised not to')
        }
      }
      return result
    },
  })
}

/** Every failure leaves as { error: { code, message } }. */
export function installErrors(app: FastifyInstance) {
  app.setNotFoundHandler((request, reply) => {
    reply.code(404).send({ error: { code: 'not-found', message: `No route ${request.method} ${request.url}` } })
  })

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof HttpError) {
      if (err.code === 'rate-limited' && err.extra.retryAfter) reply.header('retry-after', err.extra.retryAfter)
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...err.extra } })
    }
    const status = (err as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) {
      return reply.code(400).send({ error: { code: 'invalid', message: (err as Error).message } })
    }
    request.log.error({ err }, 'unhandled error')
    return reply.code(500).send({ error: { code: 'internal', message: 'Something went wrong' } })
  })
}
