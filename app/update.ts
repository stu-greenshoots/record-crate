/**
 * A new version of the app installs in the background and waits (see public/sw.js):
 * swapping it in under an open app would leave the app asking for files the deploy
 * took away. So offer it instead, and reload once it has taken over.
 *
 * The app is often left open for days, so look for a new version whenever it comes
 * back to the front, and offer a waiting one again each time until it's taken.
 */
const CHECK_EVERY_MS = 15 * 60 * 1000

export function watchForUpdates(
  reg: ServiceWorkerRegistration,
  offer: (apply: () => void) => void,
  { container = navigator.serviceWorker, reload = () => location.reload() } = {},
) {
  const offerWaiting = () => {
    const waiting = reg.waiting
    // With no controller this is the first install, which takes over by itself.
    if (waiting && container.controller) offer(() => waiting.postMessage('skip-waiting'))
  }

  let controller = container.controller
  container.addEventListener('controllerchange', () => {
    if (controller) reload()
    controller = container.controller
  })

  reg.addEventListener('updatefound', () => {
    const next = reg.installing
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed') offerWaiting()
    })
  })

  let checked = Date.now()
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return
    if (Date.now() - checked > CHECK_EVERY_MS) {
      checked = Date.now()
      reg.update().catch(() => {})
    }
    offerWaiting()
  })

  offerWaiting()
}
