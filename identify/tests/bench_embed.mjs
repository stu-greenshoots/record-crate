/**
 * Measure image-embedding models for "which of my sleeves is this?" — the matcher
 * that runs in the browser. Embeds every cover in public/covers, then each
 * synthetic photo from phone_photos.py, and reports top-1 / top-5 per condition.
 *
 *   node identify/tests/bench_embed.mjs PHOTOS_DIR [model ...]
 */
import fs from 'node:fs'
import path from 'node:path'
import { AutoProcessor, AutoModel, CLIPVisionModelWithProjection, RawImage, env } from '@huggingface/transformers'

env.allowLocalModels = false
const ROOT = path.resolve(import.meta.dirname, '../..')
const [photos, ...models] = process.argv.slice(2)
const snapshot = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/collection.json'), 'utf8'))
const truth = JSON.parse(fs.readFileSync(path.join(photos, 'truth.json'), 'utf8'))

const covers = [...new Map(snapshot.records.filter((r) => r.cover).map((r) => [r.releaseId, r.cover])).entries()]

function norm(v) {
  let s = 0
  for (const x of v) s += x * x
  s = Math.sqrt(s)
  return v.map((x) => x / s)
}

/**
 * Grey-world white balance plus a percentile contrast stretch, applied to covers and
 * photos alike, so a dim warm room and a flat scan land in the same place.
 */
function normalise(img) {
  const d = img.data
  const n = d.length / 3
  const mean = [0, 0, 0]
  for (let i = 0; i < d.length; i++) mean[i % 3] += d[i]
  for (let c = 0; c < 3; c++) mean[c] /= n
  const grey = (mean[0] + mean[1] + mean[2]) / 3
  const gain = mean.map((m) => (process.env.NORM === 'stretch' ? 1 : grey / Math.max(m, 1)))
  const hist = new Uint32Array(256)
  for (let i = 0; i < d.length; i += 3) {
    const y = 0.299 * d[i] * gain[0] + 0.587 * d[i + 1] * gain[1] + 0.114 * d[i + 2] * gain[2]
    hist[Math.min(255, y | 0)]++
  }
  let lo = 0, hi = 255, acc = 0
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo = v; break } }
  acc = 0
  for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.01) { hi = v; break } }
  const scale = 255 / Math.max(hi - lo, 1)
  const out = new Uint8ClampedArray(d.length)
  for (let i = 0; i < d.length; i++) out[i] = (d[i] * gain[i % 3] - lo) * scale
  return new RawImage(out, img.width, img.height, 3)
}

async function load(id) {
  const processor = await AutoProcessor.from_pretrained(id)
  const Model = /clip/i.test(id) ? CLIPVisionModelWithProjection : AutoModel
  const model = await Model.from_pretrained(id, { dtype: process.env.DTYPE || 'q8' })
  const one = async (image) => {
    if (process.env.NORM) image = normalise(image.rgb())
    const inputs = await processor(image)
    const out = await model(inputs)
    if (out.image_embeds) return norm(Array.from(out.image_embeds.data))
    const t = out.last_hidden_state
    const [, tokens, dim] = t.dims
    const cls = Array.from(t.data.slice(0, dim))
    const mean = new Array(dim).fill(0)
    for (let k = 1; k < tokens; k++) for (let i = 0; i < dim; i++) mean[i] += t.data[k * dim + i] / (tokens - 1)
    const pool = process.env.POOL || 'cls'
    if (pool === 'cls') return norm(cls)
    if (pool === 'mean') return norm(mean)
    return [...norm(cls), ...norm(mean)].map((x) => x / Math.SQRT2)
  }
  return async (file, query = false) => {
    const image = await RawImage.read(file)
    if (!query || !process.env.CROPS) return [await one(image)]
    // Several centred crops: whichever best frames the sleeve wins.
    const views = [await one(image)]
    for (const f of process.env.CROPS.split(',').map(Number)) {
      const w = Math.round(image.width * f), h = Math.round(image.height * f)
      views.push(await one(await image.crop([(image.width - w) >> 1, (image.height - h) >> 1, ((image.width - w) >> 1) + w - 1, ((image.height - h) >> 1) + h - 1])))
    }
    return views
  }
}

for (const id of models) {
  const t0 = Date.now()
  const embed = await load(id)
  const index = []
  for (const [releaseId, cover] of covers) index.push({ releaseId, v: (await embed(path.join(ROOT, 'public', cover)))[0] })
  const perCover = (Date.now() - t0) / covers.length
  console.log(`\n${id}  dim ${index[0].v.length}  ~${perCover.toFixed(0)}ms/image (node, cpu)`)
  for (const cond of truth.conditions) {
    let top1 = 0, top5 = 0, margin = []
    for (const [rid, releaseId] of Object.entries(truth.truth)) {
      const qs = await embed(path.join(photos, cond, `${rid}.jpg`), true)
      const scored = index
        .map((e) => ({ releaseId: e.releaseId, s: Math.max(...qs.map((q) => e.v.reduce((a, x, i) => a + x * q[i], 0))) }))
        .sort((a, b) => b.s - a.s)
      if (process.env.DUMP) fs.appendFileSync(process.env.DUMP, JSON.stringify({ cond, ok: scored[0].releaseId === releaseId, s1: scored[0].s, m: scored[0].s - scored[1].s }) + '\n')
      if (scored[0].releaseId === releaseId) {
        top1++
        margin.push(scored[0].s - scored[1].s)
      }
      if (scored.slice(0, 5).some((x) => x.releaseId === releaseId)) top5++
    }
    const n = Object.keys(truth.truth).length
    const m = margin.sort((a, b) => a - b)[Math.floor(margin.length / 2)] ?? 0
    console.log(`  ${cond.padEnd(12)} top-1 ${String(top1).padStart(2)}/${n}  top-5 ${String(top5).padStart(2)}/${n}  median margin ${m.toFixed(3)}`)
  }
}
