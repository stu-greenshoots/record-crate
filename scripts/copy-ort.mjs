/**
 * Ship the plain WebAssembly build of ONNX Runtime with the app, matched to the
 * installed onnxruntime-web. transformers.js would otherwise fetch the 27MB
 * WebGPU-capable build from a CDN; this one is 14MB and is all the recogniser uses.
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT } from '../server/config.js'

const from = path.join(ROOT, 'node_modules/onnxruntime-web/dist')
const to = path.join(ROOT, 'public/ort')
fs.mkdirSync(to, { recursive: true })
for (const f of ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']) {
  fs.copyFileSync(path.join(from, f), path.join(to, f))
}
console.log('ONNX Runtime wasm copied to public/ort')
