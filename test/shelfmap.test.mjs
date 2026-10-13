import { buildShelfMap, DEFAULT_MAP } from '../shared/shelfmap.js'
import { shelfWidth } from '../shared/thickness.js'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}

const SHELVES = [
  { id: 'main', name: 'Main Shelf' },
  { id: 'screen', name: 'Screen & Play' },
  { id: 'comps', name: 'Compilations' },
  { id: 'metal', name: 'Heavy Rotation' },
  { id: 'singles', name: 'Singles' },
]

let nextId = 1
const rec = (sortName, { shelf = 'main', width = 1 } = {}) =>
  ({ instanceId: nextId++, sortName, shelf, width })

/** Letters only, so a split boundary reads like a real one ("Bm") rather than "B0". */
const suffix = (i) => {
  const a = 'abcdefghijklmnopqrstuvwxyz'
  return a[Math.floor(i / 26) % 26] + a[i % 26]
}

function make(dist, extras = {}) {
  const out = []
  for (const [letter, n] of Object.entries(dist))
    for (let i = 0; i < n; i++) out.push(rec(`${letter}${suffix(i)}`))
  for (const [shelf, n] of Object.entries(extras))
    for (let i = 0; i < n; i++) out.push(rec(`Q${i}`, { shelf }))
  return out
}

const LUMPY = {A:23,B:42,C:36,D:27,E:18,F:16,G:32,H:28,I:10,J:35,K:22,L:17,M:30,N:6,O:6,P:22,Q:5,R:17,S:42,T:9,U:5,V:6,W:20,Y:2,Z:9}
const records = make(LUMPY, { metal: 52, screen: 40, comps: 25, singles: 30 })
// Capacity with real headroom over the average, which is when whole letters can fit.
const ROOMY = { ...DEFAULT_MAP, capacity: 90 }
const built = buildShelfMap(ROOMY, records, SHELVES)

console.log('\n— The unit —\n')
for (let row = 0; row < built.rows; row++)
  console.log('  ' + built.slots.filter(s => s.row === row)
    .map(s => `${s.label.padEnd(18)}${String(s.count).padStart(3)}${s.over ? ' !' : '  '}`).join(' | '))

const flow = built.slots.filter(s => s.type === 'flow')
console.log(`\n  loads: ${flow.map(s => s.count).join(', ')}\n`)

ok(built.slots.length === 12, '12 cubes for a 4x3 unit')
ok(built.unplaced.length === 0, 'every record lands in a cube')
ok(built.slots.reduce((a, s) => a + s.count, 0) === records.length, 'counts sum to the collection')

// No record may be placed twice — the invariant the whole unit rests on.
const seen = new Set()
let twice = 0
for (const s of built.slots) for (const id of s.instanceIds) (seen.has(id) ? twice++ : seen.add(id))
ok(twice === 0, 'no record is placed in two cubes')

ok(flow.every(s => !s.over), 'no lettered cube exceeds capacity')

// Records must fill in filed order: each cube is a contiguous run.
const mainSorted = records.filter(r => r.shelf === 'main')
  .sort((a, b) => (a.sortName < b.sortName ? -1 : 1)).map(r => r.instanceId)
const flowOrder = flow.flatMap(s => s.instanceIds)
ok(JSON.stringify(flowOrder) === JSON.stringify(mainSorted), 'cubes fill in filed order, contiguously')

// Whole letters where they fit: no label should show a two-character boundary.
const splitLabels = flow.filter(s => /[A-Z][a-z]/.test(s.label)).map(s => s.label)
ok(splitLabels.length === 0, 'letters stay whole when there is room', splitLabels.join(', '))

// Squeeze the same collection into cubes barely above the average and letters must
// give way — that is the "if it has to change, so be it" case.
const tight = buildShelfMap({ ...DEFAULT_MAP, capacity: 58 }, records, SHELVES)
const tightFlow = tight.slots.filter(s => s.type === 'flow')
ok(tightFlow.some(s => /[A-Z][a-z]/.test(s.label)) && tightFlow.every(s => !s.over),
   'a tight shelf splits letters rather than overflowing',
   tightFlow.map(s => s.label).join(' | '))

// ...but a letter too big for one cube MUST split, or the shelf would overflow.
const huge = buildShelfMap(
  { ...DEFAULT_MAP, capacity: 30 },
  make({ A: 5, B: 140, C: 5 }),
  SHELVES,
)
const hugeFlow = huge.slots.filter(s => s.type === 'flow')
ok(hugeFlow.some(s => /[A-Z][a-z]/.test(s.label)), 'a letter bigger than a cube is split',
   hugeFlow.map(s => s.label).filter(l => l !== 'empty').join(' | '))

// Width, not headcount, decides the fill.
const fat = [...Array(40)].map((_, i) => rec(`A${suffix(i)}`, { width: 3 }))
  .concat([...Array(40)].map((_, i) => rec(`Z${suffix(i)}`, { width: 0.4 })))
const byWidth = buildShelfMap({ ...DEFAULT_MAP, capacity: 40 }, fat, SHELVES)
const fatCubes = byWidth.slots.filter(s => s.type === 'flow' && s.count)
ok(fatCubes.length > 2 && fatCubes[0].count < 40,
   'thick records fill cubes faster than thin ones',
   fatCubes.map(s => `${s.label}:${s.count}rec/${s.width}w`).join(' '))

// The bottom row is still the three named shelves, in order.
const bottom = built.slots.filter(s => s.row === built.rows - 1)
ok(bottom[1].label === 'Heavy Rotation', 'bottom row: Heavy Rotation')
ok(bottom[2].label === 'Screen & Play', 'bottom row: Screen & Play')
ok(bottom[3].label === 'Compilations + Singles', 'bottom row: Compilations + Singles')
ok(built.cols === 4 && built.rows === 3, 'defaults to 4 wide, 3 high')

console.log('\n— Split modes —')
const flowOf = (b) => b.slots.filter(s => s.type === 'flow')
const filled = buildShelfMap({ ...DEFAULT_MAP, split: 'fill' }, records, SHELVES)
const fc = flowOf(filled)
ok(fc.slice(0, -1).every(s => s.width <= DEFAULT_MAP.capacity), 'fill: no cube but the last goes over capacity',
   fc.map(s => s.width).join(' '))
ok(fc.slice(0, 5).every(s => s.width > DEFAULT_MAP.capacity - 2), 'fill: early cubes are filled to the brim')
ok(fc.reduce((a, s) => a + s.count, 0) === records.filter(r => r.shelf === 'main').length, 'fill: every record placed')

const lettered = buildShelfMap({ ...ROOMY, split: 'letters' }, records, SHELVES)
const lc = flowOf(lettered)
ok(lc[0].from === 'A' && lc.every((s, i) => !i || s.from > lc[i - 1].from), 'letters: suggested starts begin at A and climb',
   lc.map(s => s.from).join(' '))
ok(lc.every(s => !/[a-z]/.test(s.label)), 'letters: labels are whole letters', lc.map(s => s.label).join(' | '))
const letterOf = new Map(records.map(r => [r.instanceId, r.sortName[0]]))
ok(lc.every((s, i) => s.instanceIds.every(id => letterOf.get(id) >= s.from && (!lc[i + 1] || letterOf.get(id) < lc[i + 1].from))),
   'letters: every record sits in the cube for its letter')

const handSet = structuredClone(DEFAULT_MAP)
handSet.split = 'letters'
'A B C D H M P S W'.split(' ').forEach((l, i) => (handSet.slots[i].from = l))
const hs = flowOf(buildShelfMap(handSet, records, SHELVES))
ok(hs[0].label === 'A' && hs[3].label === 'D – G' && hs[8].label === 'W – Z', 'letters: hand-set starts are used as given',
   hs.map(s => s.label).join(' | '))
handSet.slots[2].from = 'A'
const bad = flowOf(buildShelfMap(handSet, records, SHELVES))
ok(bad[0].from === 'A' && bad[2].from !== 'A', 'letters: out-of-order starts fall back to suggested ones')
const digits = buildShelfMap({ ...ROOMY, split: 'letters' }, [...records, rec('10cc')], SHELVES)
ok(flowOf(digits)[0].instanceIds.includes(nextId - 1), 'letters: a name starting with a number goes with A')

console.log('\n— Shelf width —')
const w = (formats, weight) => shelfWidth({ formats }, weight)
const LP = [{ name: 'Vinyl', qty: '1', descriptions: ['LP', 'Album'] }]
ok(w(LP) === 1, 'a plain single LP is 1.00')
ok(w([{ name: 'Vinyl', qty: '2', descriptions: ['LP'] }]) > w(LP) * 1.5, 'a double takes far more room')
ok(w([{ ...LP[0], text: 'Gatefold' }]) > w(LP), 'a gatefold takes more than a plain sleeve')
ok(w([{ ...LP[0], text: '180 Gram' }]) > w(LP), '180-gram takes more than standard weight')
ok(w([{ name: 'Vinyl', qty: '1', descriptions: ['7"', 'Single'] }]) < 0.5, 'a 7" is a fraction of an LP')
ok(w(LP, 460) > w(LP, 230), "Discogs' own weight estimate moves the figure")

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
