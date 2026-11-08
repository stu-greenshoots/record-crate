// @vitest-environment node
import Fastify from 'fastify'
import { describe, expect, it } from 'vitest'
import { buildApp, type Deps } from '../api/app'
import { loadConfig } from '../api/config'
import { HttpError, installErrors, serve } from '../api/http'

const config = loadConfig({ NODE_ENV: 'test' })
const up: Deps = { checks: { db: async () => true, queue: async () => true } }

describe('configuration', () => {
  it('runs locally against the Docker Compose services with no setup', () => {
    expect(config.databaseUrl).toBe('postgres://crate:crate@localhost:5433/crate')
    expect(config.redisUrl).toBe('redis://localhost:6380')
    expect(config.checkResponses).toBe(true)
  })

  it('refuses to start in production without its services named', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/DATABASE_URL: required in production/)
    const prod = loadConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://x@db/c', REDIS_URL: 'redis://r' })
    expect(prod.checkResponses).toBe(false)
  })

  it('names every bad setting', () => {
    expect(() => loadConfig({ PORT: 'eighty' })).toThrow(/PORT/)
  })
})

describe('health', () => {
  it('is ok when the database and the queue answer', async () => {
    const res = await buildApp(config, up).inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true, db: true, queue: true })
  })

  it('says which dependency is down, with a 503 for the proxy', async () => {
    const app = buildApp(config, { checks: { db: async () => true, queue: async () => Promise.reject(new Error('x')) } })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toEqual({ ok: false, db: true, queue: false })
  })

  it('gives up on a dependency that hangs', async () => {
    const app = buildApp(config, { checks: { db: () => new Promise(() => {}), queue: async () => true } })
    const res = await app.inject({ method: 'GET', url: '/api/health' })
    expect(res.json()).toMatchObject({ ok: false, db: false })
  }, 5000)
})

describe('requests and errors', () => {
  it('tags every response with a request id, keeping a sensible one it was given', async () => {
    const app = buildApp(config, up)
    const given = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': 'abc-12345' } })
    expect(given.headers['x-request-id']).toBe('abc-12345')
    const junk = await app.inject({ method: 'GET', url: '/api/health', headers: { 'x-request-id': '<script>' } })
    expect(junk.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('answers an unknown route in the contract error shape', async () => {
    const res = await buildApp(config, up).inject({ method: 'GET', url: '/api/nope' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: { code: 'not-found', message: 'No route GET /api/nope' } })
  })
})

describe('serving a contract route', () => {
  function appWith(caller: { userId: string } | null, handler: Parameters<typeof serve<'release'>>[2]) {
    const app = Fastify()
    app.decorateRequest('caller', null)
    app.decorateRequest('admin', false)
    app.addHook('onRequest', async (req) => {
      req.caller = caller
    })
    installErrors(app)
    serve(app, 'release', handler, { checkResponses: true })
    return app
  }

  const detail = {
    verdict: null,
    versionCount: null,
    released: null,
    country: null,
    labels: [],
    physical: [],
    cutters: [],
    runouts: [],
    notes: [],
    have: null,
    want: null,
    rating: null,
    value: { currency: null, mint: null, nearMint: null, vgPlus: null, vg: null, lowest: null, forSale: null },
    uri: 'https://www.discogs.com/release/1',
  }

  it("turns away a caller who isn't signed in", async () => {
    const res = await appWith(null, async () => detail).inject({ method: 'GET', url: '/api/releases/1' })
    expect(res.statusCode).toBe(401)
    expect(res.json().error.code).toBe('unauthenticated')
  })

  it('hands the handler parsed, typed params', async () => {
    let seen: unknown
    const app = appWith({ userId: 'u1' }, async ({ params }) => {
      seen = params
      return detail
    })
    const res = await app.inject({ method: 'GET', url: '/api/releases/42' })
    expect(res.statusCode).toBe(200)
    expect(seen).toEqual({ releaseId: 42 })
  })

  it('says exactly what was wrong with a bad request', async () => {
    const res = await appWith({ userId: 'u1' }, async () => detail).inject({ method: 'GET', url: '/api/releases/abc' })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toMatchObject({ code: 'invalid', issues: [{ path: 'params.releaseId' }] })
  })

  it('catches a handler sending something the contract does not allow', async () => {
    const res = await appWith({ userId: 'u1' }, async () => ({ ...detail, uri: 42 }) as never).inject({
      method: 'GET',
      url: '/api/releases/1',
    })
    expect(res.statusCode).toBe(500)
    expect(res.json().error.code).toBe('internal')
  })

  it('passes on an error the handler raises, with its status', async () => {
    const res = await appWith({ userId: 'u1' }, async () => {
      throw new HttpError('rate-limited', 'Discogs needs a minute', { retryAfter: 30 })
    }).inject({ method: 'GET', url: '/api/releases/1' })
    expect(res.statusCode).toBe(429)
    expect(res.headers['retry-after']).toBe('30')
    expect(res.json().error).toEqual({ code: 'rate-limited', message: 'Discogs needs a minute', retryAfter: 30 })
  })

  it('hides the detail of an unexpected failure', async () => {
    const res = await appWith({ userId: 'u1' }, async () => {
      throw new Error('password=hunter2')
    }).inject({ method: 'GET', url: '/api/releases/1' })
    expect(res.statusCode).toBe(500)
    expect(res.body).not.toContain('hunter2')
  })
})
