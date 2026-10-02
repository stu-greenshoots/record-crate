/**
 * Offline support. The app should open instantly in front of the shelf, signal or
 * not, so everything it needs is cached:
 *
 *   - the page and its built assets: precached at install, so even the second
 *     launch works offline; the page itself is network-first with a short timeout
 *   - the collection and recognition index: served from cache, refreshed behind
 *   - the vector file: named by its content hash, so cache-first is safe
 *   - covers: served from cache, refreshed behind
 *   - the model and the ONNX runtime: cache-first, in a cache named after their
 *     versions, so an upgrade fetches them again and nothing else does
 *
 * __BUILD__ and __RUNTIME__ are filled in by the build (vite.app.config.ts).
 */
const BUILD = '0ccbe98963'
const RUNTIME = '1.31.0-dev.20260914-8d85527a0-24451943'
const SHELL = `crate-shell-${BUILD}`
const MODEL = `crate-model-${RUNTIME}`
const COVERS = 'crate-covers'
const KEEP = [SHELL, MODEL, COVERS]

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL)
      const res = await fetch('./', { cache: 'no-cache' })
      const html = await res.clone().text()
      await cache.put('./', res)
      const assets = [...new Set(html.match(/assets\/[^"')\s]+/g) || [])]
      await cache.addAll([
        ...assets,
        'data/collection.json',
        'data/embeddings.json',
        'manifest.webmanifest',
        'icon.svg',
        'icon-180.png',
        'icon-192.png',
      ])
      await self.skipWaiting()
    })(),
  )
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
  const timeout = new Promise((resolve) => setTimeout(resolve, 2500))
  const first = await Promise.race([network.catch(() => null), timeout])
  if (first) return first
  const cached = (await cache.match(request)) || (await cache.match('./'))
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
    if (request.mode === 'navigate' || path === '' || path === 'index.html') {
      return event.respondWith(networkFirst(request))
    }
    if (/^data\/embeddings-.*\.bin$/.test(path) || path.startsWith('assets/')) {
      return event.respondWith(cacheFirst(request, SHELL))
    }
    if (path.startsWith('data/')) return event.respondWith(staleWhileRevalidate(request, SHELL))
    if (/^(models|ort)\//.test(path)) return event.respondWith(cacheFirst(request, MODEL))
    if (path.startsWith('covers/')) return event.respondWith(staleWhileRevalidate(request, COVERS))
    if (/\.(png|svg|webmanifest)$/.test(path)) return event.respondWith(staleWhileRevalidate(request, SHELL))
    return
  }

  if (/fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, COVERS))
  }
})
