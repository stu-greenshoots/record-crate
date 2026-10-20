import { armAngle, grooves, radiusAt, reach, timeAt, lengths, withLengths } from '../shared/needle.js'

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
ok(lengths(side(null, null)).join() === '600,600', 'no lengths at all: a typical 20-minute side, in equal bands')

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
ok(near(radiusAt(0, 500, a, lp), radiusAt(1, 0, a, lp), 0.0001), "the needle doesn't run past the end of the track it's on")
const quiet = side(null, null, null)
const r1 = radiusAt(0, 60, quiet, lp)
ok(lp.outer - r1 < (lp.outer - lp.inner) * 0.06, 'with no lengths, a minute in moves the needle a few percent of the way, not across the record', String(lp.outer - r1))
ok(withLengths(side(null, 200), [300, 180]).tracks.map((t) => t.seconds).join() === '300,200', "Spotify's lengths fill the gaps; Discogs' own are kept")
ok(withLengths(side(null), [null]).tracks[0].seconds === null, 'and no length from either stays unknown')

// An arm pivoting up and to the right of a record at the origin, radius 100.
const P = [97, -55]
const L = 95
let n = reach(P[0], P[1], L, 0, 0, 60)
ok(n && near(Math.hypot(n.x - P[0], n.y - P[1]), L, 1e-6) && near(Math.hypot(n.x, n.y), 60, 1e-6), 'the needle is an arm\'s length from the pivot, on the groove asked for', JSON.stringify(n))
const both = [reach(P[0], P[1], L, 0, 0, 60), reach(P[0], P[1], L, 0, 0, 96)]
ok(both.every((p) => p.y < 0), 'it comes down on the top of the record, the part that shows')
ok(reach(P[0], P[1], L, 0, 0, 5) === null, "a groove the arm can't reach: none")
const outer = reach(P[0], P[1], L, 0, 0, 96)
const inner = reach(P[0], P[1], L, 0, 0, 41)
ok(Math.atan2(inner.y - P[1], inner.x - P[0]) !== Math.atan2(outer.y - P[1], outer.x - P[0]), 'the arm swings in as the side plays')

// Pivot to the right of the spindle: the arm points left, crossing 180 as it swings in.
const above = armAngle(100, 0, { x: 0, y: -5 })
const below = armAngle(100, 0, { x: 0, y: 5 })
ok(Math.abs(above - below) < 10, "the arm's angle doesn't wrap as it swings past pointing left", `${above} ${below}`)
ok(Math.abs(above - 90) < 180 && Math.abs(below - 90) < 180, 'from resting straight down (90) it swings the short way onto the record')

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
