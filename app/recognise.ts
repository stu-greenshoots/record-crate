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

export type View = 'full' | 'centre' | 'both'

/**
 * Fold two answers into one, each record keeping its better score — the two halves
 * of an alternating full/centre scan.
 */
export function merge(a: Match[], b: Match[]): Match[] {
  const best = new Map<number, number>()
  for (const m of [...a, ...b]) best.set(m.releaseId, Math.max(best.get(m.releaseId) ?? -1, m.score))
  return [...best].map(([releaseId, score]) => ({ releaseId, score })).sort((x, y) => y.score - x.score)
}

export function recognise(image: ImageData, view: View = 'both'): Promise<Result> {
  warmUp()
  const id = ++seq
  return new Promise((resolve) => {
    pending.set(id, resolve)
    worker!.postMessage(
      { type: 'frame', id, view, width: image.width, height: image.height, data: image.data.buffer },
      [image.data.buffer],
    )
  })
}
