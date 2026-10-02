/// <reference lib="webworker" />
/**
 * Sleeve recognition, off the main thread so the camera preview never stutters.
 *
 * Embeds a frame with DINOv2-small and compares it with the precomputed embedding
 * of every cover in the collection. There are two views — the whole guide square
 * and its centre 80% — and a record keeps its better score: a sleeve framed a
 * little loosely is found by the tighter view. On synthetic phone photos that took a
 * dim, loosely framed shot from 37/60 to 49/60 right first time. The live camera
 * asks for one view per frame, alternating, to halve the wait between answers.
 */
import { AutoModel, AutoProcessor, RawImage, env } from '@huggingface/transformers'
import { MODEL_ID, embedFrom } from '../shared/embed.js'

declare const self: DedicatedWorkerGlobalScope

type Init = { type: 'init'; base: string }
type View = 'full' | 'centre' | 'both'
type Frame = { type: 'frame'; id: number; width: number; height: number; data: ArrayBuffer; view: View }

let ready: Promise<void> | null = null
let processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>>
let model: Awaited<ReturnType<typeof AutoModel.from_pretrained>>
let index: number[] = []
let vectors: Float32Array
let dim = 384

function halfToFloat(h: number) {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? NaN : s * Infinity
  return s * 2 ** (e - 15) * (1 + f / 1024)
}

async function init(base: string) {
  env.allowRemoteModels = false
  env.allowLocalModels = true
  env.localModelPath = `${base}models/`
  // Our own copy of the plain wasm runtime (see scripts/copy-ort.mjs).
  env.backends.onnx.wasm!.wasmPaths = {
    mjs: `${base}ort/ort-wasm-simd-threaded.mjs`,
    wasm: `${base}ort/ort-wasm-simd-threaded.wasm`,
  }
  const [meta, bin] = await Promise.all([
    fetch(`${base}data/embeddings.json`).then((r) => r.json()),
    fetch(`${base}data/embeddings.bin`).then((r) => r.arrayBuffer()),
  ])
  index = meta.index
  dim = meta.dim
  const half = new Uint16Array(bin)
  vectors = new Float32Array(half.length)
  for (let i = 0; i < half.length; i++) vectors[i] = halfToFloat(half[i])

  processor = await AutoProcessor.from_pretrained(MODEL_ID)
  model = await AutoModel.from_pretrained(MODEL_ID, {
    dtype: 'q8',
    progress_callback: (p: { status: string; progress?: number; file?: string }) => {
      if (p.status === 'progress' && p.file?.endsWith('.onnx')) {
        self.postMessage({ type: 'progress', progress: p.progress ?? 0 })
      }
    },
  })
}

function score(q: number[], into: Float32Array) {
  for (let r = 0; r < index.length; r++) {
    let s = 0
    const o = r * dim
    for (let i = 0; i < dim; i++) s += vectors[o + i] * q[i]
    if (s > into[r]) into[r] = s
  }
}

async function recognise(frame: Frame) {
  const image = new RawImage(new Uint8ClampedArray(frame.data), frame.width, frame.height, 4).rgb()
  const t0 = performance.now()
  const best = new Float32Array(index.length).fill(-1)
  if (frame.view !== 'centre') score(await embedFrom(processor, model, image), best)
  if (frame.view !== 'full') {
    const w = Math.round(frame.width * 0.8)
    const h = Math.round(frame.height * 0.8)
    const x = (frame.width - w) >> 1
    const y = (frame.height - h) >> 1
    score(await embedFrom(processor, model, await image.crop([x, y, x + w - 1, y + h - 1])), best)
  }

  const ranked = [...best.keys()].sort((a, b) => best[b] - best[a]).slice(0, 8)
  return {
    ms: Math.round(performance.now() - t0),
    matches: ranked.map((i) => ({ releaseId: index[i], score: best[i] })),
  }
}

self.onmessage = async (e: MessageEvent<Init | Frame>) => {
  const msg = e.data
  try {
    if (msg.type === 'init') {
      ready ??= init(msg.base)
      await ready
      self.postMessage({ type: 'ready' })
    } else if (msg.type === 'frame') {
      await ready
      self.postMessage({ type: 'result', id: msg.id, ...(await recognise(msg)) })
    }
  } catch (err) {
    self.postMessage({ type: 'error', message: String((err as Error)?.message || err) })
  }
}
