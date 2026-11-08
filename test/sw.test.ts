// @vitest-environment node
import fs from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { stampServiceWorker } from '../scripts/stamp-sw.mjs'

/**
 * public/sw.js run as the browser would run it, against an in-memory Cache Storage
 * and a fake server, so a deploy can be played out: one worker installed, the
 * server's files replaced, the next worker installed beside it.
 */

const SCOPE = 'https://crate.test/record-crate/'
const SOURCE = fs.readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8')

type Input = string | URL | { url: string }
const abs = (input: Input) =>
  typeof input === 'string' ? new URL(input, SCOPE).href : input instanceof URL ? input.href : input.url

const ok = (body: string) => () => new Response(body, { status: 200 })
const status = (code: number) => () => new Response(`error ${code}`, { status: code })

/** What the server has at each path; anything else is a 404. */
type Routes = Record<string, () => Response | Promise<Response>>

function server(routes: Routes) {
  const files = { ...routes }
  const fetch = vi.fn(async (input: Input) => (files[abs(input).slice(SCOPE.length)] ?? status(404))())
  return {
    fetch,
    deploy(next: Routes) {
      for (const k of Object.keys(files)) delete files[k]
      Object.assign(files, next)
    },
  }
}

function cacheStorage(fetch: (input: Input) => Promise<Response>) {
  const stores = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const store = stores.get(name)!
    return {
      match: async (req: Input) => store.get(abs(req))?.clone(),
      put: async (req: Input, res: Response) => void store.set(abs(req), res),
      // Like the real thing, add and addAll refuse a response that isn't ok.
      add: async (req: Input) => {
        const res = await fetch(req)
        if (!res.ok) throw new TypeError(`${abs(req)}: ${res.status}`)
        store.set(abs(req), res)
      },
      addAll: async (reqs: Input[]) => {
        const all = await Promise.all(reqs.map((r) => fetch(r)))
        all.forEach((res, i) => {
          if (!res.ok) throw new TypeError(`${abs(reqs[i])}: ${res.status}`)
        })
        all.forEach((res, i) => store.set(abs(reqs[i]), res))
      },
    }
  }
  return {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: Input) => {
      for (const store of stores.values()) if (store.has(abs(req))) return store.get(abs(req))!.clone()
    },
    has: (name: string, path: string) => Boolean(stores.get(name)?.has(abs(path))),
  }
}

/** Start a service worker from public/sw.js, stamped as the build stamps it. */
function worker(build: string, assets: string[], net: ReturnType<typeof server>, caches: ReturnType<typeof cacheStorage>) {
  const listeners: Record<string, (e: unknown) => void> = {}
  const self = {
    addEventListener: (type: string, fn: (e: unknown) => void) => (listeners[type] = fn),
    registration: { scope: SCOPE },
    skipWaiting: vi.fn(async () => {}),
    clients: { claim: vi.fn(async () => {}) },
  }
  // Request resolves relative URLs against the worker's own address, as in a browser.
  class Req extends Request {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(typeof input === 'string' ? new URL(input, SCOPE) : input, init)
    }
  }
  const source = stampServiceWorker(SOURCE, { build, runtime: 'ort-1', assets })
  new Function('self', 'caches', 'fetch', 'Request', source)(self, caches, net.fetch, Req)

  const lifecycle = (type: string, data?: unknown) => {
    let done: Promise<unknown> = Promise.resolve()
    listeners[type]({ data, waitUntil: (p: Promise<unknown>) => (done = p) })
    return done
  }
  return {
    self,
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    message: (data: unknown) => lifecycle('message', data),
    async get(path: string, mode: RequestMode | 'navigate' = 'cors') {
      let res: Promise<Response> | undefined
      listeners.fetch({ request: { url: SCOPE + path, method: 'GET', mode }, respondWith: (p: Promise<Response>) => (res = p) })
      if (!res) throw new Error(`${path} isn't handled by the worker`)
      return res
    },
  }
}

const OLD_ASSETS = ['assets/index-old.js', 'assets/index-old.css', 'assets/recognise.worker-old.js', 'assets/fraunces-a.woff2']
const NEW_ASSETS = ['assets/index-new.js', 'assets/index-new.css', 'assets/recognise.worker-new.js', 'assets/fraunces-a.woff2']

const site = (assets: string[], tag: string): Routes => ({
  '': ok(`<html>${tag}<script src="${assets[0]}"></script></html>`),
  'data/collection.json': ok(`{"build":"${tag}"}`),
  'data/embeddings.json': ok('{}'),
  'manifest.webmanifest': ok('{}'),
  'icon.svg': ok('<svg/>'),
  'icon-180.png': ok('png'),
  'icon-192.png': ok('png'),
  ...Object.fromEntries(assets.map((a) => [a, ok(`${a} body`)])),
})

function setup(routes: Routes = site(OLD_ASSETS, 'old')) {
  const net = server(routes)
  const caches = cacheStorage(net.fetch)
  return { net, caches, sw: worker('old', OLD_ASSETS, net, caches) }
}

describe('install', () => {
  it('caches the page, the collection and every file the build made, lazily loaded ones too', async () => {
    const { caches, sw } = setup()
    await sw.install()
    for (const path of ['./', 'data/collection.json', 'data/embeddings.json', ...OLD_ASSETS]) {
      expect(caches.has('crate-shell-old', path), path).toBe(true)
    }
  })

  it("waits rather than taking over the app that's open", async () => {
    const { sw } = setup()
    await sw.install()
    expect(sw.self.skipWaiting).not.toHaveBeenCalled()
  })

  it('fails rather than keep an error page as the app', async () => {
    const { caches, sw } = setup({ ...site(OLD_ASSETS, 'old'), '': status(500) })
    await expect(sw.install()).rejects.toThrow()
    expect(caches.has('crate-shell-old', './')).toBe(false)
  })

  it('fails when a file the build made is missing', async () => {
    const routes = site(OLD_ASSETS, 'old')
    delete routes['assets/recognise.worker-old.js']
    const { sw } = setup(routes)
    await expect(sw.install()).rejects.toThrow()
  })
})

describe('a deploy', () => {
  async function deployed() {
    const { net, caches, sw: old } = setup()
    await old.install()
    await old.activate()
    // The deploy force-pushes: the old build's hashed files are gone from the server.
    net.deploy(site(NEW_ASSETS, 'new'))
    const next = worker('new', NEW_ASSETS, net, caches)
    await next.install()
    return { net, caches, old, next }
  }

  it('leaves the open app every file of the build it is running', async () => {
    const { old } = await deployed()
    // Never loaded before the deploy (the recogniser starts on demand), and now
    // gone from the server.
    const res = await old.get('assets/recognise.worker-old.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('assets/recognise.worker-old.js body')
  })

  it('takes over only when asked, then clears out the old build', async () => {
    const { caches, next } = await deployed()
    expect(next.self.skipWaiting).not.toHaveBeenCalled()
    expect(caches.has('crate-shell-old', 'assets/index-old.js')).toBe(true)

    await next.message('skip-waiting')
    expect(next.self.skipWaiting).toHaveBeenCalled()
    await next.activate()
    expect(await caches.keys()).toEqual(['crate-shell-new'])
    expect(next.self.clients.claim).toHaveBeenCalled()
  })

  it('ignores other messages', async () => {
    const { next } = await deployed()
    await next.message('hello')
    expect(next.self.skipWaiting).not.toHaveBeenCalled()
  })
})

describe('network first (the page and the collection)', () => {
  async function installed(routes?: Routes) {
    const s = setup(routes)
    await s.sw.install()
    return s
  }

  it('serves and keeps a fresh copy', async () => {
    const { net, caches, sw } = await installed()
    net.deploy({ ...site(OLD_ASSETS, 'old'), 'data/collection.json': ok('{"build":"fresh"}') })
    expect(await (await sw.get('data/collection.json')).text()).toBe('{"build":"fresh"}')
    expect(await (await caches.open('crate-shell-old')).match('data/collection.json')!.then((r) => r!.text())).toBe(
      '{"build":"fresh"}',
    )
  })

  it.each([404, 500, 503])('falls back to the cached copy when the server answers %i', async (code) => {
    const { net, caches, sw } = await installed()
    net.deploy({ ...site(OLD_ASSETS, 'old'), 'data/collection.json': status(code) })
    const res = await sw.get('data/collection.json')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('{"build":"old"}')
    // ...and doesn't overwrite it with the error.
    const kept = await (await caches.open('crate-shell-old')).match('data/collection.json')
    expect(kept!.status).toBe(200)
  })

  it('falls back to the cached app when a page fails to load', async () => {
    const { net, sw } = await installed()
    net.deploy({ ...site(OLD_ASSETS, 'old'), '': status(500) })
    const res = await sw.get('', 'navigate')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('old')
  })

  it("passes the error on when there's nothing cached to fall back to", async () => {
    const { net, sw } = await installed()
    net.deploy({ ...site(OLD_ASSETS, 'old'), 'index.html': status(500) })
    expect((await sw.get('index.html')).status).toBe(500)
  })

  it('falls back to the cache when the network is down', async () => {
    const { net, sw } = await installed()
    net.fetch.mockRejectedValue(new TypeError('offline'))
    expect(await (await sw.get('data/collection.json')).text()).toBe('{"build":"old"}')
  })
})

describe('stamping', () => {
  it('fills in every placeholder', () => {
    const out = stampServiceWorker(SOURCE, { build: 'b1', runtime: 'r1', assets: ['assets/a.js'] })
    expect(out).not.toMatch(/'__BUILD__'|'__RUNTIME__'|\/\*__ASSETS__\*\//)
    expect(out).toContain("'b1'")
    expect(out).toContain('["assets/a.js"]')
  })

  it("refuses a worker that's missing a placeholder", () => {
    expect(() => stampServiceWorker("const BUILD = 'x'", { build: 'b', runtime: 'r', assets: [] })).toThrow()
  })
})
