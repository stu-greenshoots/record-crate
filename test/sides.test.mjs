import { cut, seconds, sides } from '../shared/sides.js'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}
const t = (position, duration = '', type = 'track', title = position) => ({ position, title, duration, type })
const letters = (list, discs) => sides(list, discs).map((s) => s.side).join('')

ok(seconds('8:43') === 523, 'minutes and seconds')
ok(seconds('1:02:03') === 3723, 'hours too')
ok(seconds('') === null && seconds('?') === null, 'no length is null')

const lp = [t('A1', '8:43'), t('A2', '14:58'), t('B1', '6:39'), t('B2', '10:00')]
ok(letters(lp) === 'AB', 'an LP has sides A and B')
ok(sides(lp)[1].tracks.map((x) => x.seconds).join() === '399,600', 'each side keeps its tracks and lengths')
ok(letters([t('A1'), t('B1'), t('C1'), t('D1')]) === 'ABCD', 'a double album has four sides, in order')
ok(letters([t('A'), t('B')]) === 'AB', 'a single: one track a side, no number')
ok(sides([t('A'), t('AA')]).map((x) => x.side).join() === 'A,AA', 'a double-A single keeps its AA side')
ok(letters([t('', '', 'heading', 'Part One'), t('A1'), t('B1')]) === 'AB', 'headings are not tracks')
ok(letters([t('B1a'), t('B1b'), t('B1.ii'), t('A1')]) === 'BA', 'sub-tracks belong to their side; order is as listed')
ok(letters([t('CD1-1'), t('A1'), t('B1'), t('DVD-1')]) === 'AB', 'a bonus CD or DVD in the box is not a side')
ok(letters([t('1'), t('2'), t('3')]) === 'AB', 'numbered tracks only: an LP is still two sides')
ok(letters([t('1'), t('2')], 2) === 'ABCD', 'numbered tracks on two discs: four sides')
ok(letters([]) === 'AB', 'no track list: two sides')
ok(sides([t('1'), t('2')])[0].tracks.length === 0, "numbered tracks can't be put on a side")
ok(letters([t('A1'), t('A2')]) === 'AB', 'a one-sided list still gets a B side', letters([t('A1'), t('A2')]))

const cd = (...mins) => mins.map((m, i) => ({ title: `T${i + 1}`, seconds: m * 60 }))
let c = cut(cd(5, 5, 5, 5, 5, 5, 5, 5))
ok(c.map((s) => s.side + s.tracks.length).join() === 'A4,B4', 'a 40-minute CD album is cut into two even sides', c.map((s) => s.side + s.tracks.length).join())
ok(c[1].tracks[0].position === 'B1' && c[1].tracks[0].seconds === 300, 'with side positions and lengths')
c = cut(cd(10, 10, 10, 10, 10, 10, 10, 10))
ok(c.length === 4 && c.every((s) => s.tracks.length === 2), 'an 80-minute album needs two records: four sides', c.map((s) => s.tracks.length).join())
c = cut(cd(18, 2, 2, 2))
ok(c[0].tracks.length === 1 && c[1].tracks.length === 3, 'a long first track gets a side of its own, as it would on vinyl')
c = cut([{ title: 'a', seconds: null }, { title: 'b', seconds: null }, { title: 'c', seconds: null }, { title: 'd', seconds: null }])
ok(c.map((s) => s.tracks.length).join() === '2,2', 'no lengths: tracks shared out evenly')

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
