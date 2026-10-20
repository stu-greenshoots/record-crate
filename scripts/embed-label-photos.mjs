/**
 * DINOv2 embeddings of every downloaded label-candidate photo, for telling label
 * photos from the rest (identify/labels.py), or of the label crops, for telling the
 * ones that are really the whole record (identify/discs.py).
 *
 *   node scripts/embed-label-photos.mjs           # data/label-src/*.jpg -> data/label-src-embed.json
 *   node scripts/embed-label-photos.mjs --crops   # data/label-crops/*.jpg -> data/label-crops-embed.json
 */
import fs from 'node:fs'
import path from 'node:path'
import { AutoProcessor, AutoModel, RawImage } from '@huggingface/transformers'
import { DATA_DIR } from '../server/config.js'
import { MODEL_ID, embedFrom } from '../shared/embed.js'

const which = process.argv.includes('--crops') ? 'label-crops' : 'label-src'
const SRC = path.join(DATA_DIR, which)
const OUT = path.join(DATA_DIR, `${which}-embed.json`)
const done = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {}
const processor = await AutoProcessor.from_pretrained(MODEL_ID)
const model = await AutoModel.from_pretrained(MODEL_ID, { dtype: 'q8' })

const files = fs.readdirSync(SRC).filter((f) => f.endsWith('.jpg') && !(f.slice(0, -4) in done))
let n = 0
for (const f of files) {
  try {
    const v = await embedFrom(processor, model, await RawImage.read(path.join(SRC, f)))
    done[f.slice(0, -4)] = v.map((x) => Math.round(x * 1e5) / 1e5)
  } catch (err) {
    console.log(f, err.message)
  }
  if (++n % 200 === 0) {
    fs.writeFileSync(OUT, JSON.stringify(done))
    console.log(`${n}/${files.length}`)
  }
}
fs.writeFileSync(OUT, JSON.stringify(done))
console.log(`${Object.keys(done).length} embedded`)
