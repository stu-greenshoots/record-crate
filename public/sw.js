/**
 * Offline support. The app should open instantly in front of the shelf, signal or
 * not, so everything it needs is cached after the first visit:
 *
 *   - the page itself: network first, so a new release shows up when online
 *   - the collection and the recognition index: served from cache, refreshed behind
 *   - covers, the model, built assets and the inference runtime: cache first —
 *     they never change under the same URL
 */
const VERSION = 'v1'
const SHELL = `crate-shell-${VERSION}`
const STATIC = `crate-static-${VERSION}`

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.addAll(['./', 'data/collection.json', 'manifest.webmanifest', 'icon.svg']))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, STATIC].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  )
})

const scope = new URL(self.registration.scope)

async function networkFirst(request) {
  const cache = await caches.open(SHELL)
  try {
    const res = await fetch(request)
    if (res.ok) cache.put(request, res.clone())
    return res
  } catch {
    return (await cache.match(request)) || (await cache.match('./')) || Response.error()
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(SHELL)
  const cached = await cache.match(request)
  const fresh = fetch(request)
    .then((res) => {
      if (res.ok) cache.put(request, res.clone())
      return res
    })
    .catch(() => cached)
  return cached || fresh
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC)
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
    if (path.startsWith('data/')) return event.respondWith(staleWhileRevalidate(request))
    if (/^(covers|models|assets)\//.test(path) || /\.(png|svg)$/.test(path)) {
      return event.respondWith(cacheFirst(request))
    }
    return
  }

  // The ONNX runtime's WebAssembly, and the fonts.
  if (/cdn\.jsdelivr\.net|fonts\.(googleapis|gstatic)\.com/.test(url.hostname)) {
    event.respondWith(cacheFirst(request))
  }
})
