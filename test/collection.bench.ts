import fs from 'node:fs'
import { bench, describe, vi } from 'vitest'
import { synthesize } from '../scripts/synth-collection.mjs'
import { buildShelfMap } from '../shared/shelfmap.js'
import type { Snapshot } from '../app/types'

/**
 * How filing scales with the size of the collection: the real snapshot, then made-up
 * ones of 2k, 5k and 10k. `npx vitest bench --run`; needs public/data/collection.json.
 */
const REAL = 'public/data/collection.json'
const real: Snapshot | null = fs.existsSync(REAL) ? JSON.parse(fs.readFileSync(REAL, 'utf8')) : null
const sizes: [string, Snapshot][] = real
  ? [['664 (real)', real], ...[2000, 5000, 10000].map((n): [string, Snapshot] => [String(n), synthesize(real, n) as Snapshot])]
  : []
const opts = { iterations: 5, warmupIterations: 1, time: 0 }

for (const [name, snap] of sizes) {
  const records = snap.records.map((r) => ({ ...r, instanceId: r.id }))

  describe(`${name} records`, () => {
    for (const split of ['even', 'fill', 'letters'] as const) {
      bench(`buildShelfMap, split ${split}`, () => {
        buildShelfMap({ ...snap.shelfMap, split }, records, snap.shelves)
      }, opts)
    }

    let store: typeof import('../app/store')
    bench(
      'take a record out (update + derive)',
      () => {
        store.takeOut(snap.records[0].id)
      },
      {
        ...opts,
        setup: async () => {
          localStorage.clear()
          vi.resetModules()
          vi.stubGlobal('fetch', async () => new Response(JSON.stringify(snap)))
          store = await import('../app/store')
          await store.load()
        },
      },
    )
  })
}
