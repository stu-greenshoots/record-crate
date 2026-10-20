import { grooves, radiusAt, timeAt, lengths } from '../shared/needle.js'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}
const near = (a, b, d = 0.01) => Math.abs(a - b) <= d
const side = (...secs) => ({ side: 'A', tracks: secs.map((s, i) => ({ position: `A${i + 1}`, title: `T${i + 1}`, seconds: s })) })

const lp = grooves(12)
ok(lp.outer < 1 && lp.inner > 0.357 && lp.inner < 0.45, 'an LP plays from near the edge to just outside the label', JSON.stringify(lp))
const single = grooves(7)
ok(single.inner > lp.inner, 'a 7" label takes more of the record, so its grooves stop further out')

const a = side(100, 300, 200)
ok(lengths(a).join() === '100,300,200', 'track lengths as given')
ok(lengths(side(100, null, 200)).join() === '100,150,200', 'a missing length is the average of the known ones')
ok(lengths(side(null, null)).join() === '1,1', 'no lengths at all: equal bands')

let t = timeAt(lp.outer, a, lp)
ok(t.track === 0 && t.offset === 0, 'the outer edge is the start of the first track')
t = timeAt(lp.inner, a, lp)
ok(t.track === 2 && near(t.offset, 200, 0.5), 'the inner edge is the end of the last track', JSON.stringify(t))
const mid = lp.outer - (lp.outer - lp.inner) * (250 / 600)
t = timeAt(mid, a, lp)
ok(t.track === 1 && near(t.offset, 150, 1), 'halfway through the second track', JSON.stringify(t))
const justAfterGap = lp.outer - (lp.outer - lp.inner) * (103 / 600)
t = timeAt(justAfterGap, a, lp)
ok(t.track === 1 && t.offset === 0, 'a touch just past a gap starts that track from the top', JSON.stringify(t))
t = timeAt(lp.outer + 0.05, a, lp)
ok(t.track === 0 && t.offset === 0, 'touching the lead-in starts at the beginning')
ok(timeAt(lp.inner - 0.05, a, lp) === null, 'touching the run-out or the label plays nothing')

ok(near(radiusAt(1, 150, a, lp), mid, 0.002), 'and back again: a time gives the radius the needle sits at')
ok(near(radiusAt(0, 0, a, lp), lp.outer), 'the first track starts at the edge')
ok(timeAt(0.8, { side: 'A', tracks: [] }, lp) === null, 'a side with no known tracks plays nothing')

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
