import { fromBackup, mergeIntoOverrides, toBackup } from '../shared/backup.js'

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
  runoutOf: { 101: 2 },
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

const laptop = {
  shelves: [{ id: 'main', name: 'Main Shelf' }, { id: 'singles', name: 'Singles' }],
  records: { 101: { shelf: 'main', position: null }, 7: { shelf: 'main', position: null } },
  artists: { 'id:1': { sortName: 'Bowie' } },
  settings: {},
  shelfMap: { cols: 4, rows: 3, capacity: 83, flowShelf: 'main', slots: [] },
}
const before = JSON.stringify(laptop)
const merged = mergeIntoOverrides(laptop, { ...local, shelfOf: { 7: 'singles', 999: 'main' } }, 42)
const m = merged.overrides
ok(m.records[7].shelf === 'singles' && m.records[7].movedAt === 42, 'a record moved on the phone moves on the laptop')
ok(m.records[101].sortName === 'Bowie, David', 'a corrected name is kept on that record')
ok(m.artists['id:1'].sortName === 'Bowie', "an artist's own override is left alone")
ok(m.shelves[1].name === '7-inches' && m.shelfMap.split === 'letters', 'shelves and the unit come across')
ok(!('out' in m) && !('sorted' in m) && !m.records[101].out, 'what is out and the ticks stay on the phone')
ok(merged.changes.some((c) => c.startsWith('skip 999')), 'a record the laptop does not have is reported, not invented')
ok(!m.records[999], 'and is not added')
ok(JSON.stringify(laptop) === before, 'the overrides passed in are not changed')
const again = mergeIntoOverrides(m, local)
ok(again.changes.length === 0, 'importing the same backup twice changes nothing')

console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exit(1)
