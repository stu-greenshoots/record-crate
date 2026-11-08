/**
 * Offline support. The app should open instantly in front of the shelf, signal or
 * not, so everything it needs is cached:
 *
 *   - the page and every file the build made: precached at install, so even the
 *     second launch works offline; the page itself is network-first with a short
 *     timeout
 *   - the collection: network-first with the same short timeout, so a new snapshot
 *     shows up the first time the app opens after a deploy
 *   - the recognition index: served from cache, refreshed behind
 *   - the vector file: named by its content hash, so cache-first is safe
 *   - covers, labels and pressing notes: served from cache, refreshed behind
 *   - the model and the ONNX runtime: cache-first, in a cache named after their
 *     versions, so an upgrade fetches them again and nothing else does
 *
 * A new version installs beside the old one and waits. A deploy replaces every
 * hashed file on the server, so an app that's already open stays with the old
 * worker, whose cache holds every file of its build (the recogniser's worker and
 * the fonts load long after the page does), until it's closed or you tap Reload
 * (app/update.ts).
 *
 * __BUILD__, __RUNTIME__ and __ASSETS__ are filled in by the build
 * (vite.app.config.ts).
 */
const BUILD = '__BUILD__'
const RUNTIME = '__RUNTIME__'
const ASSETS = /*__ASSETS__*/ []
const SHELL = `crate-shell-${BUILD}`
const MODEL = `crate-model-${RUNTIME}`
const COVERS = 'crate-covers'
const KEEP = [SHELL, MODEL, COVERS]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL)
      const page = await fetch('./', { cache: 'no-cache' })
      if (!page.ok) throw new Error(`The page answered ${page.status}`)
      await cache.put('./', page)
      await cache.add(new Request('data/collection.json', { cache: 'no-cache' }))
      await cache.addAll([
        ...ASSETS,
        'data/embeddings.json',
        'manifest.webmanifest',
        'icon.svg',
        'icon-180.png',
        'icon-192.png',
      ])
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const scope = new URL(self.registration.scope)

async function networkFirst(request) {
  const cache = await caches.open(SHELL)
  const network = fetch(request).then((res) => {
    if (res.ok) cache.put(request, res.clone())
    return res
  })
  // On a weak signal, don't keep a record in your hand waiting: fall back to the
  // cached page after a moment and let the network fill the cache for next time.
  // An error from the server (a 404 mid-deploy, a 5xx) is no better than no
  // signal: the cached copy wins.
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500))
  const first = await Promise.race([network.then((res) => (res.ok ? res : null), () => null), timeout])
  if (first) return first
  const cached = (await cache.match(request)) || (request.mode === 'navigate' ? await cache.match('./') : null)
  return cached || network.catch(() => Response.error())
}

async function staleWhileRevalidate(request, name) {
  const cache = await caches.open(name)
  const cached = await cache.match(request)
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone())
      return res
    })
    .catch(() => cached || Response.error())
  return cached || fresh
}

async function cacheFirst(request, name) {
  const cache = await caches.open(name)
  const cached = await cache.match(request)
  if (cached) return cached
  const res = await fetch(request)
  if (res.ok) cache.put(request, res.clone())
  return res
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return
  const url = new URL(request.url)

  if (url.origin === scope.origin && url.pathname.startsWith(scope.pathname)) {
    const path = url.pathname.slice(scope.pathname.length)
    if (request.mode === 'navigate' || path === '' || path === 'index.html' || path === 'data/collection.json') {
      return event.respondWith(networkFirst(request))
    }
    if (/^data\/embeddings-.*\.bin$/.test(path) || path.startsWith('assets/')) {
      return event.respondWith(cacheFirst(request, SHELL))
    }
    if (path.startsWith('data/')) return event.respondWith(staleWhileRevalidate(request, SHELL))
    if (/^(models|ort)\//.test(path)) return event.respondWith(cacheFirst(request, MODEL))
    if (/^(covers|labels|discs|pressings|artists)\//.test(path)) return event.respondWith(staleWhileRevalidate(request, COVERS))
    if (/\.(png|svg|webmanifest)$/.test(path)) return event.respondWith(staleWhileRevalidate(request, SHELL))
    return
  }
})
