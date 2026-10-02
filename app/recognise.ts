/**
 * Main-thread handle on the recognition worker. The model (24MB) is fetched the first
 * time the camera opens and cached by the browser after that.
 */

export interface Match {
  releaseId: number
  score: number
}

export interface Result {
  ms: number
  matches: Match[]
}

type Listener = (state: RecogniserState) => void

export interface RecogniserState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  progress: number
  error?: string
}

let worker: Worker | null = null
let state: RecogniserState = { status: 'idle', progress: 0 }
const listeners = new Set<Listener>()
const pending = new Map<number, (r: Result) => void>()
let seq = 0

function set(next: Partial<RecogniserState>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l(state))
}

export function onRecogniser(l: Listener) {
  listeners.add(l)
  l(state)
  return () => {
    listeners.delete(l)
  }
}

export function warmUp() {
  if (worker) return
  worker = new Worker(new URL('./recognise.worker.ts', import.meta.url), { type: 'module' })
  set({ status: 'loading', progress: 0 })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === 'progress') set({ progress: m.progress })
    else if (m.type === 'ready') set({ status: 'ready', progress: 100 })
    else if (m.type === 'error') set({ status: 'error', error: m.message })
    else if (m.type === 'result') {
      pending.get(m.id)?.(m)
      pending.delete(m.id)
    }
  }
  worker.postMessage({ type: 'init', base: new URL(import.meta.env.BASE_URL, location.href).href })
}

export function recognise(image: ImageData): Promise<Result> {
  warmUp()
  const id = ++seq
  return new Promise((resolve) => {
    pending.set(id, resolve)
    worker!.postMessage(
      { type: 'frame', id, width: image.width, height: image.height, data: image.data.buffer },
      [image.data.buffer],
    )
  })
}
