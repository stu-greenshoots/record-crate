import { catnoSimilarity, fuzzyCatno, normaliseCatno } from '../server/identify.js'

let pass = 0
let fail = 0

function check(label, actual, expected) {
  const ok = actual === expected
  ok ? pass++ : fail++
  console.log(
    `${ok ? ' ok ' : 'FAIL'}  ${label.padEnd(52)}${ok ? '' : ` got ${actual}, wanted ${expected}`}`,
  )
}

/** The read and the known number are the same record. */
function same(read, known, note = '') {
  const score = catnoSimilarity(read, known)
  const ok = score !== null && score > 0
  ok ? pass++ : fail++
  console.log(
    `${ok ? ' ok ' : 'FAIL'}  ${`${read} = ${known}`.padEnd(36)}${String(score ?? 'null').padEnd(6)} ${note}`,
  )
}

/** The read and the known number are different records, however similar they look. */
function different(read, known, note = '') {
  const score = catnoSimilarity(read, known)
  const ok = score === null
  ok ? pass++ : fail++
  console.log(
    `${ok ? ' ok ' : 'FAIL'}  ${`${read} ≠ ${known}`.padEnd(36)}${String(score ?? 'null').padEnd(6)} ${note}`,
  )
}

console.log('\n— Normalising —')
check('spaces and dots fall out', normaliseCatno('6359 034'), '6359034')
check('dashes fall out', normaliseCatno('675 890-1'), '6758901')
check('case is levelled', normaliseCatno('mosh079fdr'), 'MOSH079FDR')
check('lookalikes collapse', fuzzyCatno('SLS 50160'), fuzzyCatno('5L5 5016O'))

console.log('\n— A clean read matches exactly —')
same('K 50014', 'K 50014', 'identical')
same('6359 034', '6359 034', 'identical')
check('an exact read scores 1', catnoSimilarity('SHVL 804', 'SHVL 804'), 1)
check('punctuation does not matter', catnoSimilarity('GULP.1005', 'GULP 1005'), 1)

console.log('\n— The shape confusions OCR actually makes are forgiven —')
same('MOSHO79FDR', 'MOSH079FDR', 'O read for 0')
same('V2O27', 'V2027', 'O read for 0')
same('5L5 5016O', 'SLS 50160', 'S/5, L/1, O/0')
same('CEP 40243', 'CFP 40243', 'E read for F')
same('2027', 'V2027', 'leading character dropped')

console.log('\n— Neighbouring catalogue numbers are NOT the same record —')
// Labels number their releases in sequence, so one digit apart is the record
// filed next to it, not a misread of this one.
different('K 50014', 'K 50012', 'Houses Of The Holy vs its shelf neighbour')
different('6359 034', '6359 035', 'consecutive Vertigo pressings')
different('SHVL 804', 'SHVL 805', 'consecutive Harvest pressings')
different('CBS 32075', 'CBS 32412', 'Stained Class vs British Steel')
different('SMALP1124', 'SMALP1024', 'the two pressings of I See You')

console.log('\n— Nothing matches nothing —')
different('', 'K 50014', 'empty read')
different('K 50014', '', 'empty known')
different('NONE', 'K 50014', 'the placeholder catalogue number')
different('V2027', 'OVED 15', 'the two pressings of Angel’s Egg')

console.log('\n— A dropped letter is forgiven; a dropped digit is not —')
same('2027', 'V2027', 'the prefix letter ran into the sleeve edge')
same('MOSH079FD', 'MOSH079FDR', 'a trailing letter lost')
different('K 5014', 'K 50014', 'dropping a digit makes another real number')
different('MOSH79FDR', 'MOSH079FDR', 'same — safer to miss than to guess')
different('635 034', '6359 034', 'a digit gone from the label prefix')

console.log(`\n${pass} passed, ${fail} failed\n`)
if (fail) process.exit(1)
