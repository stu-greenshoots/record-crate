import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { watchForUpdates } from '../app/update'

const fakeWorker = (state: ServiceWorkerState) => Object.assign(new EventTarget(), { state, postMessage: vi.fn() })
type FakeWorker = ReturnType<typeof fakeWorker>

function setup({ controlled = true, waiting = null as FakeWorker | null } = {}) {
  const reg = Object.assign(new EventTarget(), {
    waiting,
    installing: null as FakeWorker | null,
    update: vi.fn(async () => {}),
  })
  const container = Object.assign(new EventTarget(), { controller: controlled ? fakeWorker('activated') : null })
  const offer = vi.fn<(apply: () => void) => void>()
  const reload = vi.fn()
  watchForUpdates(reg as unknown as ServiceWorkerRegistration, offer, {
    container: container as unknown as ServiceWorkerContainer,
    reload,
  })

  return {
    reg,
    container,
    offer,
    reload,
    /** A new version is found and installs. */
    found() {
      const next = fakeWorker('installing')
      reg.installing = next
      reg.dispatchEvent(new Event('updatefound'))
      next.state = 'installed'
      reg.installing = null
      reg.waiting = next
      next.dispatchEvent(new Event('statechange'))
      return next
    },
    /** A worker takes control of the page. */
    takeOver() {
      container.controller = fakeWorker('activating')
      container.dispatchEvent(new Event('controllerchange'))
    },
  }
}

function foreground() {
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('watchForUpdates', () => {
  it('offers a new version that installs while the app is open', () => {
    const app = setup()
    expect(app.offer).not.toHaveBeenCalled()
    app.found()
    expect(app.offer).toHaveBeenCalledOnce()
  })

  it('offers a new version that was already waiting when the app opened', () => {
    const app = setup({ waiting: fakeWorker('installed') })
    expect(app.offer).toHaveBeenCalledOnce()
  })

  it("doesn't offer the very first install, which has nothing to replace", () => {
    const app = setup({ controlled: false })
    app.found()
    expect(app.offer).not.toHaveBeenCalled()
  })

  it('switches to the new version only when the offer is taken', () => {
    const app = setup()
    const next = app.found()
    expect(next.postMessage).not.toHaveBeenCalled()
    app.offer.mock.calls[0][0]()
    expect(next.postMessage).toHaveBeenCalledWith('skip-waiting')
  })

  it('reloads once the new version has taken over', () => {
    const app = setup()
    app.takeOver()
    expect(app.reload).toHaveBeenCalledOnce()
  })

  it("doesn't reload when the first install takes control", () => {
    const app = setup({ controlled: false })
    app.takeOver()
    expect(app.reload).not.toHaveBeenCalled()
  })

  it('looks for a new version when the app comes back to the front, now and then', () => {
    const app = setup()
    foreground()
    expect(app.reg.update).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16 * 60 * 1000)
    foreground()
    expect(app.reg.update).toHaveBeenCalledOnce()
    foreground()
    expect(app.reg.update).toHaveBeenCalledOnce()
  })

  it('offers a waiting version again when the app comes back to the front', () => {
    const app = setup()
    app.found()
    foreground()
    expect(app.offer).toHaveBeenCalledTimes(2)
  })
})
