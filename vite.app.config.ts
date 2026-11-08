import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { stampServiceWorker } from './scripts/stamp-sw.mjs'

/**
 * The phone app: a static site with the collection baked in, served from GitHub
 * Pages under /record-crate/. BASE overrides that for local preview.
 */
export default defineConfig({
  root: 'app',
  publicDir: '../public',
  base: process.env.BASE ?? '/record-crate/',
  plugins: [
    react(),
    {
      // onnxruntime-web references its WebGPU build, so Vite emits it; the app loads
      // the plain wasm from /ort instead (scripts/copy-ort.mjs), so drop the 27MB copy.
      name: 'drop-unused-ort',
      generateBundle(_, bundle) {
        for (const name of Object.keys(bundle)) if (/ort-wasm.*\.wasm$/.test(name)) delete bundle[name]
      },
    },
    {
      // Stamp the service worker: its shell cache follows the build, its model cache
      // follows the ONNX runtime and model versions, and it precaches every file the
      // build made, not just the ones the page links to.
      name: 'stamp-service-worker',
      apply: 'build',
      closeBundle() {
        const out = path.resolve('dist-app')
        const sw = path.join(out, 'sw.js')
        if (!fs.existsSync(sw)) return
        const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8')
        const data = fs.readFileSync(path.join(out, 'data/embeddings.json'), 'utf8')
        const build = crypto.createHash('sha1').update(html + data).digest('hex').slice(0, 10)
        const ort = JSON.parse(fs.readFileSync('node_modules/onnxruntime-web/package.json', 'utf8')).version
        const model = fs.statSync(path.join(out, 'models/Xenova/dinov2-small/onnx/model_quantized.onnx')).size
        const assets = fs.readdirSync(path.join(out, 'assets')).map((f) => `assets/${f}`)
        fs.writeFileSync(
          sw,
          stampServiceWorker(fs.readFileSync(sw, 'utf8'), { build, runtime: `${ort}-${model}`, assets }),
        )
      },
    },
  ],
  build: { outDir: '../dist-app', emptyOutDir: true, target: 'es2022' },
  server: { port: 5178, host: true },
  preview: { port: 5179, host: true },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
