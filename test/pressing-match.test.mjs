import { etchingSimilarity, normaliseEtching, rankPressings } from '../shared/pressingMatch.js'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}

const matrix = (value, description = 'Side A') => ({ type: 'Matrix / Runout', value, description })

// Abbey Road again: the UK first pressing and its -2/-2 cut, the later -4 cut,
// and a Dutch pressing with its own etchings entirely.
const ukFirst = {
  id: 2607424, title: 'The Beatles - Abbey Road', year: 1969, country: 'UK',
  labels: [{ name: 'Apple', catno: 'PCS 7088' }],
  identifiers: [matrix('YEX 749-1'), matrix('YEX 750-1', 'Side B')],
}
const ukLater = {
  id: 555, title: 'The Beatles - Abbey Road', year: 1969, country: 'UK',
  labels: [{ name: 'Apple', catno: 'PCS 7088' }],
  identifiers: [matrix('YEX 749-4'), matrix('YEX 750-4', 'Side B')],
}
const dutch = {
  id: 777, title: 'The Beatles - Abbey Road', year: 1969, country: 'Netherlands',
  labels: [{ name: 'Apple', catno: '5C 062-04243' }],
  identifiers: [matrix('5C062-04243-A1'), matrix('5C062-04243-B1', 'Side B')],
}
const shortlist = [ukFirst, ukLater, dutch]

// --- etchingSimilarity ------------------------------------------------------

ok(normaliseEtching(' yex 749-1 ') === 'YEX7491', 'normalises case, spaces and punctuation')
ok(etchingSimilarity('YEX 749-1', 'YEX749-1') === 1, 'spacing differences are the same etching')
ok(etchingSimilarity('YEX 749-1', 'YEX 749-1 Random Machine-stamped') === 0.95,
  'a fragment contained in the full transcription is a near-certain match')
ok(etchingSimilarity('ABC', 'YEX 749-1') === null, 'too short to mean anything')
ok(etchingSimilarity('COMPLETELY', 'DIFFERENT1') === null, 'dissimilar strings are not forced into a score')

// --- exact runout match -----------------------------------------------------

let out = rankPressings(shortlist, { runouts: ['YEX 749-1'] })
ok(out.candidates[0].releaseId === 2607424, 'exact runout puts the first pressing on top',
  JSON.stringify(out.candidates.map((c) => [c.releaseId, c.score])))
ok(out.candidates[0].matched.runout.known === 'YEX 749-1', 'and says which etching matched')
ok(out.confidence === 'runout', 'confidence names the runout as the basis')

// --- fuzzy runout match (one character misread) -----------------------------

out = rankPressings(shortlist, { runouts: ['YEX 740-1'] })
ok(out.candidates[0].releaseId === 2607424, 'a one-character misread still finds the right pressing')
ok(out.candidates[0].matched.runout.score < 1, 'with less than full confidence',
  String(out.candidates[0].matched.runout.score))

// --- ambiguous: signals shared by two pressings -----------------------------

out = rankPressings(shortlist, { catno: 'PCS 7088', year: 1969, country: 'UK' })
const [first, second] = out.candidates
ok(first.score === second.score, 'two UK pressings tie without a runout',
  JSON.stringify([first.score, second.score]))
ok(first.distinguishers.length > 0 && second.distinguishers.length > 0,
  'both contenders say which etching would settle it')
ok(first.distinguishers[0].includes('YEX 749'), 'the hint names a real etching', first.distinguishers[0])

// --- no runout at all -------------------------------------------------------

out = rankPressings(shortlist, { catno: '5C 062-04243' })
ok(out.candidates[0].releaseId === 777, 'catalogue number alone ranks the Dutch pressing first')
ok(out.confidence === 'printed-details-only', 'and the confidence says the ranking rests on printed details')

// --- nothing usable ---------------------------------------------------------

out = rankPressings(shortlist, {})
ok(out.confidence === 'none', 'no signals, no claimed confidence')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
