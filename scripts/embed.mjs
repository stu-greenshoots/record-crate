/**
 * Precompute the sleeve-recognition index: one DINOv2-small embedding per cover,
 * using the exact model and preprocessing the browser runs, so a photo taken on the
 * phone is compared like with like.
 *
 *   node scripts/embed.mjs     # after export.mjs; writes public/data/embeddings.bin
 *
 * The file is float16, row-major, in the order of `index` in embeddings.json.
 * Also copies the model into public/models so the app never depends on a model hub.
 */
import fs from 'node:fs'
import path from 'node:path'
import { AutoProcessor, AutoModel, RawImage, env } from '@huggingface/transformers'
import { ROOT } from '../server/config.js'
import { MODEL_ID, embedFrom } from '../shared/embed.js'

const PUBLIC = path.join(ROOT, 'public')
const snapshot = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'data/collection.json'), 'utf8'))

const processor = await AutoProcessor.from_pretrained(MODEL_ID)
const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'q8' })

// One row per distinct cover — two copies of the same pressing share a sleeve.
const covers = [...new Map(snapshot.records.filter((r) => r.cover).map((r) => [r.releaseId, r.cover]))]
const rows = []
for (const [, cover] of covers) {
  const image = await RawImage.read(path.join(PUBLIC, cover))
  rows.push(await embedFrom(processor, model, image))
}

const dim = rows[0].length
const half = new Uint16Array(rows.length * dim)
rows.forEach((v, r) => v.forEach((x, i) => (half[r * dim + i] = toHalf(x))))
fs.writeFileSync(path.join(PUBLIC, 'data/embeddings.bin'), Buffer.from(half.buffer))
fs.writeFileSync(
  path.join(PUBLIC, 'data/embeddings.json'),
  JSON.stringify({ model: MODEL_ID, dim, index: covers.map(([releaseId]) => releaseId) }),
)

// Ship the model alongside the app.
const cache = path.join(env.cacheDir, MODEL_ID)
const dest = path.join(PUBLIC, 'models', MODEL_ID)
for (const file of ['config.json', 'preprocessor_config.json', 'onnx/model_quantized.onnx']) {
  fs.mkdirSync(path.dirname(path.join(dest, file)), { recursive: true })
  fs.copyFileSync(path.join(cache, file), path.join(dest, file))
}
console.log(`${rows.length} covers embedded (${dim}d), model copied to public/models`)

function toHalf(value) {
  const f = new Float32Array([value])
  const x = new Uint32Array(f.buffer)[0]
  const sign = (x >> 16) & 0x8000
  let exp = ((x >> 23) & 0xff) - 127 + 15
  let mant = x & 0x7fffff
  if (exp <= 0) return sign // embeddings are unit vectors; subnormals are noise
  if (exp >= 31) return sign | 0x7c00
  // Round to nearest.
  mant += 0x1000
  if (mant & 0x800000) {
    mant = 0
    exp++
  }
  return sign | (exp << 10) | (mant >> 13)
}
