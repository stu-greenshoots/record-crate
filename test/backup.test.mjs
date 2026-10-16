import { fromBackup, toBackup } from '../shared/backup.js'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}
const refuses = (text, label) => {
  try {
    fromBackup(text)
    ok(false, label, 'accepted')
  } catch (err) {
    ok(err instanceof Error && err.message.length > 0, label, err.message)
  }
}

const local = {
  version: 1,
  out: { 101: 1760000000000 },
  recent: [101, 7],
  shelfOf: { 7: 'singles' },
  sortOf: { 101: 'Bowie, David' },
  shelves: [{ id: 'main', name: 'Main Shelf' }, { id: 'singles', name: '7-inches' }],
  map: { cols: 4, rows: 3, capacity: 60, split: 'letters', flowShelf: 'main', slots: [{ type: 'flow', from: 'A' }] },
  mapBase: '2026-10-13T22:26:46.008Z',
  fresh: [],
  gone: [55],
  sorted: { 0: [101, 7], 3: [12] },
  lastCheck: null,
}

const text = toBackup(local, '2026-10-13T22:26:46.008Z')
const back = fromBackup(text)
ok(JSON.stringify(back.local) === JSON.stringify(local), 'round trip keeps everything saved on the phone')
ok(back.snapshot === '2026-10-13T22:26:46.008Z', 'remembers which snapshot it was made against')
ok(!Number.isNaN(Date.parse(back.savedAt)), 'records when it was saved')

const old = JSON.parse(text)
delete old.local.lastCheck
delete old.local.fresh
const filled = fromBackup(JSON.stringify(old)).local
ok(filled.lastCheck === null && Array.isArray(filled.fresh), 'fields missing from an older backup come back empty')

refuses('not json', 'refuses something that is not JSON')
refuses(JSON.stringify(local), 'refuses bare phone data that is not a backup file')
refuses(JSON.stringify({ ...JSON.parse(text), version: 2 }), 'refuses a backup version it does not know')
refuses(JSON.stringify({ ...JSON.parse(text), local: { ...local, sorted: [] } }), 'refuses cube ticks that are not keyed by cube')
refuses(JSON.stringify({ ...JSON.parse(text), local: { ...local, out: null } }), 'refuses a missing out list')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
