import { EMPTY_FILTER, counts, isEmpty, matches, toggle } from '../shared/filter.js'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}

const rec = (id, o) => ({ id, genres: [], styles: [], label: '', people: [], year: null, originalYear: null, ...o })
const records = [
  rec(1, { genres: ['Rock'], styles: ['Prog Rock'], label: 'Virgin', year: 1983, originalYear: 1973, people: [[0, 1], [1, 2]] }),
  rec(2, { genres: ['Jazz'], styles: ['Fusion'], label: 'CBS', year: 1975, people: [[0, 1]] }),
  rec(3, { genres: ['Rock', 'Jazz'], styles: ['Prog Rock', 'Fusion'], label: 'Virgin', year: 1977 }),
  rec(4, { genres: ['Electronic'], styles: ['Ambient'], label: 'EG', year: null }),
]
const f = (o) => ({ ...EMPTY_FILTER, ...o })
const ids = (filter) => records.filter((r) => matches(r, filter)).map((r) => r.id).join(',')

ok(ids(EMPTY_FILTER) === '1,2,3,4', 'no filter, everything')
ok(isEmpty(EMPTY_FILTER) && !isEmpty(f({ from: 1970 })) && !isEmpty(f({ people: [0] })) && !isEmpty(f({ text: 'gong' })), 'knows when nothing is chosen')
ok(ids(f({ styles: ['Prog Rock'] })) === '1,3', 'one style')
ok(ids(f({ genres: ['Rock', 'Electronic'] })) === '1,3,4', 'two genres: either will do')
ok(ids(f({ genres: ['Jazz'], labels: ['Virgin'] })) === '3', 'genre and label: both must hold')
ok(ids(f({ from: 1970, to: 1975 })) === '1,2', 'year range, inclusive, by original year where known', ids(f({ from: 1970, to: 1975 })))
ok(ids(f({ from: 1980 })) === '', 'the pressing year does not count when the original is known')
ok(ids(f({ to: 2030 })) === '1,2,3', 'no year fails any year filter')
ok(ids(f({ people: [0] })) === '1,2', 'a person, on whatever records they are on')
ok(ids(f({ people: [1], styles: ['Fusion'] })) === '', 'a person and a style together')

const styleCounts = counts(records, f({ genres: ['Rock'] }), 'styles')
ok(styleCounts.get('Prog Rock') === 2 && styleCounts.get('Fusion') === 1 && !styleCounts.has('Ambient'), 'counts allow for the other kinds', JSON.stringify([...styleCounts]))
const genreCounts = counts(records, f({ genres: ['Rock'] }), 'genres')
ok(genreCounts.get('Jazz') === 2 && genreCounts.get('Electronic') === 1, "a kind's own choices don't narrow its counts", JSON.stringify([...genreCounts]))
const kept = counts(records, f({ labels: ['CBS'], genres: ['Electronic'] }), 'labels')
ok(kept.get('CBS') === 0, 'a chosen value that now gives nothing is still listed')
ok(counts(records, EMPTY_FILTER, 'genres').get('Jazz') === 2, 'a record with two genres counts once in each')

const t = toggle(EMPTY_FILTER, 'styles', 'Fusion')
ok(t.styles.join() === 'Fusion' && EMPTY_FILTER.styles.length === 0, 'toggle on, without changing the original')
ok(toggle(t, 'styles', 'Fusion').styles.length === 0, 'toggle off')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
