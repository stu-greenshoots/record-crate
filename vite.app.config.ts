import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
  ],
  build: { outDir: '../dist-app', emptyOutDir: true, target: 'es2022' },
  server: { port: 5178, host: true },
  preview: { port: 5179, host: true },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
})
