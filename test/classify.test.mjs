import { deriveSortName, classifyShelf, collationKey } from '../server/classify.js'

let pass = 0
let fail = 0

function filed(name, expected, artistInfo = null) {
  const { sortName, basis } = deriveSortName(name, artistInfo)
  const ok = sortName === expected
  ok ? pass++ : fail++
  console.log(
    `${ok ? ' ok ' : 'FAIL'}  ${name.padEnd(28)} -> ${sortName.padEnd(30)} ${ok ? '' : `(wanted ${expected})`} [${basis}]`,
  )
}

console.log('\n— Filing without any Discogs artist data (heuristic only) —')
filed('Bob Dylan', 'Dylan, Bob')
filed('Nick Cave', 'Cave, Nick')
filed('Van Morrison', 'Morrison, Van')
filed('Ludwig van Beethoven', 'Beethoven, Ludwig van')
filed('Sufjan Stevens', 'Stevens, Sufjan')
filed('The Beatles', 'Beatles, The')
filed('The Rolling Stones', 'Rolling Stones, The')
filed('Los Lobos', 'Lobos, Los')
filed('Madonna', 'Madonna')
filed('Björk', 'Björk')
filed('ABBA', 'ABBA')
filed('Simon & Garfunkel', 'Simon & Garfunkel')
filed('Various', 'Various Artists')
filed('Miles Davis Quintet', 'Miles Davis Quintet')
filed('Beatles, The (2)', 'Beatles, The')
filed('Sun Ra Arkestra', 'Sun Ra Arkestra')
filed('Public Enemy', 'Enemy, Public') // heuristic slip — see below

console.log('\n— The same names once Discogs tells us person vs group —')
filed('Fleetwood Mac', 'Fleetwood Mac', { type: 'group' })
filed('Pink Floyd', 'Pink Floyd', { type: 'group' })
filed('Public Enemy', 'Public Enemy', { type: 'group' })
filed('Talking Heads', 'Talking Heads', { type: 'group' })
filed('Bob Dylan', 'Dylan, Bob', { type: 'person' })
filed('Aphex Twin', 'Aphex Twin', { type: 'group' })

console.log('\n— CJK names are already family-first —')
filed('久石 譲', '久石 譲', { type: 'person' })
filed('坂本 龍一', '坂本 龍一', { type: 'person' })
filed('はっぴいえんど', 'はっぴいえんど')
filed('Joe Hisaishi', 'Hisaishi, Joe', { type: 'person' })

console.log('\n— A user override always wins —')
{
  const { sortName, basis } = deriveSortName('Fleetwood Mac', null, 'Fleetwood Mac')
  const ok = sortName === 'Fleetwood Mac' && basis === 'override'
  ok ? pass++ : fail++
  console.log(`${ok ? ' ok ' : 'FAIL'}  override -> ${sortName} [${basis}]`)
}

console.log('\n— Shelf classification —')
function shelf(label, info, expected) {
  const got = classifyShelf(info)
  const ok = got === expected
  ok ? pass++ : fail++
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${label.padEnd(46)} -> ${got}${ok ? '' : ` (wanted ${expected})`}`)
}

shelf('Metal LP', { genres: ['Rock'], styles: ['Heavy Metal'], formats: [{ name: 'Vinyl', descriptions: ['LP', 'Album'] }] }, 'metal')
shelf('Thrash LP', { genres: ['Rock'], styles: ['Thrash'], formats: [{ name: 'Vinyl', descriptions: ['LP'] }] }, 'metal')
shelf('Metal 7" single', { genres: ['Rock'], styles: ['Heavy Metal'], formats: [{ name: 'Vinyl', descriptions: ['7"', 'Single'] }] }, 'singles')
shelf('Film soundtrack', { genres: ['Stage & Screen'], styles: ['Soundtrack'], formats: [{ name: 'Vinyl', descriptions: ['LP'] }] }, 'screen')
shelf('Game OST by title', { genres: ['Electronic'], styles: [], title: 'Final Fantasy VII Original Soundtrack', formats: [{ name: 'Vinyl', descriptions: ['LP'] }] }, 'screen')
shelf('Various-artists comp', { genres: ['Rock'], styles: [], artist: 'Various', formats: [{ name: 'Vinyl', descriptions: ['LP', 'Compilation'] }] }, 'comps')
shelf('Plain rock album', { genres: ['Rock'], styles: ['Indie Rock'], formats: [{ name: 'Vinyl', descriptions: ['LP', 'Album'] }] }, 'main')
shelf('Maxi-single 12"', { genres: ['Electronic'], styles: ['House'], formats: [{ name: 'Vinyl', descriptions: ['12"', 'Maxi-Single'] }] }, 'singles')

console.log('\n— Collation ignores punctuation and accents —')
{
  const ok = collationKey("Björk") === 'BJORK' && collationKey("O'Connor, Sinéad") === 'OCONNOR SINEAD'
  ok ? pass++ : fail++
  console.log(`${ok ? ' ok ' : 'FAIL'}  ${collationKey('Björk')} / ${collationKey("O'Connor, Sinéad")}`)
}

console.log(`\n${pass} passed, ${fail} failed\n`)
