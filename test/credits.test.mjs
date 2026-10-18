import { ENG, PLAY, PROD, collectPeople, creditKinds, displayName } from '../shared/credits.js'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}
const kinds = (role) => creditKinds(role).mask

ok(kinds('Drums') === PLAY, 'an instrument is playing')
ok(kinds('Drums, Percussion') === PLAY, 'several instruments are still just playing')
ok(JSON.stringify(creditKinds('Drums, Percussion').plays) === '["drums","percussion"]', 'keeps each instrument by name')
ok(kinds('Guitar [12-String], Vocals') === PLAY, 'bracketed detail is dropped')
ok(kinds('Performer') === PLAY && kinds('Band') === PLAY && kinds('Conductor') === PLAY, 'line-up roles are playing')
ok(kinds('Engineer') === ENG && kinds('Lacquer Cut By') === ENG && kinds('Tape Op') === ENG, 'engineering roles')
ok(kinds('Engineer [Mastering]') === ENG, 'a bracketed engineer is still an engineer')
ok(kinds('Producer') === PROD && kinds('Executive-Producer') === PROD, 'production roles')
ok(kinds('Producer, Engineer') === (PROD | ENG), 'one credit can be both')
ok(kinds('Bass, Producer') === (PLAY | PROD), 'a player who produced is both')
ok(kinds('Design [Sleeve]') === 0, 'sleeve design is left out')
ok(kinds('Written-By') === 0 && kinds('Photography By') === 0 && kinds('Management') === 0, 'writing, photography, management left out')
ok(kinds('Arranged By, Liner Notes') === 0, 'a credit with only left-out roles counts for nothing')
ok(kinds('') === 0 && kinds(undefined) === 0, 'no role, no kind')

ok(displayName('Steve Hillage (2)') === 'Steve Hillage', 'strips the Discogs number')
ok(displayName('Blink-182') === 'Blink-182', 'leaves names that end in digits alone')

const { people, byRelease } = collectPeople([
  {
    id: 10,
    credits: [
      { id: 1, name: 'Pierre Moerlen', role: 'Drums' },
      { id: 2, name: 'Steve Hillage (2)', role: 'Guitar' },
      { id: 3, name: 'Roger Dean', role: 'Artwork' },
      { id: 4, name: 'Simon Heyworth', role: 'Engineer' },
    ],
    tracklist: [
      { credits: [{ id: 1, name: 'Pierre Moerlen', role: 'Vibraphone' }] },
      { credits: [{ id: 1, name: 'Pierre Moerlen', role: 'Vibraphone' }] },
    ],
  },
  {
    id: 20,
    credits: [
      { id: 2, name: 'Steve Hillage (2)', role: 'Guitar, Producer' },
      { id: 4, name: 'Simon Heyworth', role: 'Mastered By' },
      { id: 5, name: 'Steve Hillage', role: 'Vocals' },
    ],
  },
  {
    id: 25,
    credits: [{ id: 6, name: 'Dave Sturt', role: 'Bass, Bass Guitar, Keyboards' }],
  },
  { id: 30, credits: [{ id: 3, name: 'Roger Dean', role: 'Design' }] },
  { id: 40 },
])

const names = people.map((p) => p[0])
const at = (name, roles) => people.findIndex((p) => p[0] === name && p[1] === roles)
ok(at('Dave Sturt', 'bass, keyboards') >= 0, 'skips a role that repeats one already shown', JSON.stringify(people))
ok(!names.includes('Roger Dean'), 'someone with only left-out credits is not listed')
ok(JSON.stringify(names) === '["Dave Sturt","Pierre Moerlen","Simon Heyworth","Steve Hillage","Steve Hillage"]', 'sorted by name, once per Discogs id', JSON.stringify(names))
ok(at('Steve Hillage', 'guitar, producer') >= 0 && at('Steve Hillage', 'vocals') >= 0, 'same name, different people kept apart by their roles', JSON.stringify(people))
ok(at('Simon Heyworth', 'engineer') >= 0, 'an engineer reads as engineer')
ok(at('Pierre Moerlen', 'drums, vibraphone') >= 0, 'roles counted once per record, then by how often', JSON.stringify(people))

const ten = Object.fromEntries(byRelease[10])
ok(ten[at('Pierre Moerlen', 'drums, vibraphone')] === PLAY, 'track credits count for the record')
ok(byRelease[10].length === 3, 'each person once per record, artwork left out', JSON.stringify(byRelease[10]))
const twenty = Object.fromEntries(byRelease[20])
ok(twenty[at('Steve Hillage', 'guitar, producer')] === (PLAY | PROD), 'kinds per record, not across the collection')
ok(twenty[at('Simon Heyworth', 'engineer')] === ENG, 'mastering is engineering')
ok(!(30 in byRelease) && !(40 in byRelease), 'records with nobody listed have no entry')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
