import { cutters, noteParts, physical, runouts, verdict } from '../shared/pressing.js'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}

const lp = (descriptions, text = null) => [{ name: 'Vinyl', qty: '1', descriptions, text }]
const rel = (o) => ({ year: null, released: null, country: null, formats: lp(['LP', 'Album']), ...o })

let nextId = 1000
const v = (released, country, catno = 'X 1', id = nextId++) => ({ id, released, country, catno })

// Abbey Road: the main release is one variant of the first pressing; Discogs splits it.
const abbey = [
  v('1969', 'Italy', '3C 062-04243'),
  v('1969-09-26', 'UK', 'PCS 7088', 2607424),
  v('1969-09-26', 'UK', 'PCS 7088', 2498807),
  v('1969', 'UK', 'PCS 7088, PCS-7088'),
  v('1969', 'UK', 'PCS 7088', 555),
  v('1969', 'Netherlands', '5C 062.04243'),
  v('1987', 'UK', 'PCS 7088'),
]
const pcs = (o) => rel({ id: 2498807, year: 1969, country: 'UK', labels: [{ name: 'Apple', catno: 'PCS 7088' }], ...o })
let out = verdict(rel({ id: 2607424, year: 1969, country: 'UK', labels: [{ catno: 'PCS 7088' }] }), abbey, 1969, 2607424)
ok(out.kind === 'first' && out.text === 'First pressing' && !/Same country/.test(out.detail), 'the main release is the first pressing', JSON.stringify(out))
ok(/4 variants/.test(out.detail), 'says how many variants share its catalogue number, country and year', out.detail)

out = verdict(pcs(), abbey, 1969, 2607424)
ok(out.kind === 'first' && /Same country, catalogue number and year as the first issue \(UK, PCS 7088, 1969\)/.test(out.detail), 'a variant of the first issue is a first pressing', JSON.stringify(out))

out = verdict(pcs({ labels: [{ catno: 'PCS-7088' }] }), abbey, 1969, 2607424)
ok(out.kind === 'first', 'catalogue numbers match however they are punctuated')

out = verdict(pcs({ formats: lp(['LP', 'Album', 'Repress']) }), abbey, 1969, 2607424)
ok(out.kind === 'repress', 'a repress with the same catalogue number is not a first pressing')

out = verdict(rel({ id: 9, year: 1969, country: 'Italy', labels: [{ catno: '3C 062-04243' }] }), abbey, 1969, 2607424)
ok(out.kind === 'same-year' && out.text === '1969 Italy pressing' && /first issue \(UK, PCS 7088, 1969\)/.test(out.detail), 'the same year elsewhere is a same-year pressing', JSON.stringify(out))

out = verdict(rel({ id: 9, year: 1969, country: 'UK', labels: [{ catno: 'PMC 7088' }] }), abbey, 1969, 2607424)
ok(out.kind === 'same-year' && /not the same catalogue number/.test(out.detail), 'same year and country, different catalogue number', JSON.stringify(out))

out = verdict(rel({ id: 9, year: 1971, country: 'UK', labels: [{ catno: 'PCS 7088' }] }), abbey, 1969, 2607424)
ok(out.kind === 'reissue', 'the same catalogue number in a later year is not the first pressing')

out = verdict(rel({ year: 1971, country: 'UK' }), [v('1971', 'France'), v('1971', 'UK'), v('1971', 'UK')], 1971)
ok(out.kind === 'same-year' && /doesn't say which pressing came first/.test(out.detail), 'with no main release, a first-year pressing is not called first', JSON.stringify(out))

out = verdict(rel({ year: 1972, country: 'UK', formats: lp(['LP', 'Album', 'Repress', 'Stereo']) }), [v('1969', 'UK'), v('1972', 'UK')], 1969)
ok(out.kind === 'repress' && out.text === '1972 repress' && /first came out in 1969/.test(out.detail), 'a later repress says repress, not reissue', JSON.stringify(out))

out = verdict(rel({ id: 77, year: 1994, country: 'Ghana', formats: [{ name: 'Cassette', qty: '1', descriptions: [] }] }), [v('2015', 'US')], 1994, 77)
ok(out.kind === 'first' && out.text === 'Original cassette', 'a cassette original, the main release though not among the vinyl', JSON.stringify(out))

out = verdict(rel({ year: 1963, country: 'UK', formats: lp(['LP', 'Album', 'Repress', 'Mono']) }), [v('1963-03-22', 'UK')], 1963)
ok(out.kind === 'repress' && out.text === '1963 repress', 'a same-year repress is not the first')

out = verdict(rel({ year: 1977, country: 'UK', formats: lp(['LP', 'Album', 'Reissue']) }), [v('1972', 'UK'), v('1977', 'UK')], 1972)
ok(out.kind === 'reissue' && out.text === '1977 reissue' && /first came out in 1972/.test(out.detail), 'a later year is a reissue', JSON.stringify(out))

out = verdict(rel({ year: 1983, country: 'UK' }), [v('1973', 'UK'), v('1983', 'UK')], 1973)
ok(out.kind === 'reissue', 'a later year is a reissue even unflagged')

out = verdict(rel({ year: 1969, country: 'UK' }), [v('1968', 'US'), v('1968', 'Germany'), v('1969', 'UK')], 1968)
ok(out.kind === 'first-local' && out.text === 'First UK pressing', "the year after, in a country that hadn't had it, is that country's first", JSON.stringify(out))

out = verdict(rel({ year: 1975, country: 'UK' }), [v('1968', 'US'), v('1975', 'UK')], 1968)
ok(out.kind === 'reissue', "years later is a reissue, even where that country hadn't had it", JSON.stringify(out))

out = verdict(rel({ year: 1972, country: 'UK' }), [v('1972-00-00', 'US'), v('1972', 'UK')], 1972)
ok(out.origin === null, 'a date with no month or day is only a year', JSON.stringify(out))

out = verdict(rel({ year: 1969, country: 'UK' }), [v('1968', 'UK'), v('1969', 'UK')], 1968)
ok(out.kind === 'reissue', 'but not where that country already had it')

out = verdict(rel({ year: 2011, country: 'Germany' }), [v('2011', 'Germany'), v('2011', 'US'), v('2016', 'Germany')], 2011, 999)
ok(out.kind === 'first-vinyl' && /one of 2 that year/.test(out.detail), 'when the main release is a CD, first-year vinyl is the first vinyl pressing', JSON.stringify(out))

out = verdict(rel({ year: 2016, country: 'Germany' }), [v('2011', 'Germany'), v('2016', 'Germany')], 2011, 999)
ok(out.kind === 'reissue', 'but not later vinyl')

out = verdict(rel({ year: 2015, country: 'UK' }), [v('2015', 'UK'), v('2020', 'UK')], 1995)
ok(out.kind === 'first-vinyl' && /1995/.test(out.detail), 'the earliest vinyl of an older album is its first on vinyl', JSON.stringify(out))

out = verdict(rel({ year: 2015, country: 'US', formats: lp(['LP', 'Reissue', 'Unofficial Release']) }), [v('1967', 'US')], 1967)
ok(out.kind === 'unofficial', 'bootlegs are called out before anything else')

out = verdict(rel({ year: null, country: 'France' }), [v('1974', 'France')], 1974)
ok(out.kind === 'unknown', 'no year, no verdict')

out = verdict(rel({ id: 5, year: 1975, country: 'US', formats: lp(['LP', 'Album', 'Promo']) }), [v('1975', 'US', 'X 1', 5)], 1975, 5)
ok(out.kind === 'first' && out.promo, 'a promo of the first pressing is a first pressing, marked promo')

out = verdict(rel({ year: 1994, country: 'Ghana' }), [], null)
ok(out.kind === 'first' && out.versions === 0, 'an album with no other versions listed')

out = verdict(rel({ released: 'Mar 1978', country: 'US' }), [v('1978', 'US')], 1978)
ok(out.kind === 'same-year', 'reads the year from a written-out release date')

const winchester = {
  credits: [{ name: 'Bernie Grundman', role: 'Mastered By' }, { name: 'Ray Staff', role: 'Lacquer Cut By' }],
  companies: [
    { name: 'Capitol Records Pressing Plant, Winchester', role: 'Pressed By' },
    { name: 'Utopia Studios', role: 'Lacquer Cut At' },
  ],
  identifiers: [
    { type: 'Matrix / Runout', value: 'BSK-1-3256-WW1 A PORKY PRIME CUT', description: '(Variant 1) A-Side run-out, hand-etched' },
    { type: 'Matrix / Runout', value: 'BSK-2-3256-WW2 STERLING', description: '(Variant 1) B-Side run-out, hand-etched' },
    { type: 'Matrix / Runout', value: 'BSK-2-3256-WW2 #2', description: '(Variant 2) B-Side run-out, hand-etched' },
    { type: 'Barcode', value: '0 7599-23256-1 TML', description: null },
  ],
  formats: [{ name: 'Vinyl', qty: '2', descriptions: ['LP', 'Album', 'Gatefold', 'Mono'], text: 'Winchester Pressing' }],
}
const cut = cutters(winchester)
ok(cut.includes('Lacquer cut by Ray Staff') && cut.includes('Mastered by Bernie Grundman'), 'credited cutters and masterers', JSON.stringify(cut))
ok(cut.includes('Lacquer Cut at Utopia Studios'), 'cutting rooms from the company list', JSON.stringify(cut))
ok(cut.some((c) => /George Peckham/.test(c)) && cut.some((c) => /Sterling/.test(c)), 'marks read from the runouts')
ok(!cut.some((c) => /Bob Ludwig|Bilbo|Arun|Mastering Lab/.test(c)), 'no marks that are not there, and none read off a barcode')
const ro = runouts(winchester)
ok(ro.length === 2 && ro[0].variant === 1 && ro[0].sides.length === 2 && ro[1].sides[0].value === 'BSK-2-3256-WW2 #2', 'runouts grouped by variant, barcode left out', JSON.stringify(ro))
ok(ro[0].sides[0].side === 'A-Side run-out, hand-etched', 'variant label taken off the side description')
const phys = physical(winchester)
ok(['Pressed by Capitol Records Pressing Plant, Winchester', '2 discs', 'Mono', 'Gatefold', 'Winchester Pressing'].every((f) => phys.includes(f)), 'plant, discs, mono, gatefold, format text', JSON.stringify(phys))

const parts = noteParts('Compare to [r4297502] which is the LA pressing. Sleeve by [a=Roger Dean], see [url=https://example.com]this[/url]. [b]Bold[/b]')
ok(parts.find((p) => p.href === 'https://www.discogs.com/release/4297502')?.text === 'another release', 'release links', JSON.stringify(parts))
ok(parts.find((p) => p.text === 'Roger Dean')?.href.includes('type=artist'), 'named artist links')
ok(parts.find((p) => p.text === 'this')?.href === 'https://example.com', 'url links')
ok(parts.map((p) => p.text).join('') === 'Compare to another release which is the LA pressing. Sleeve by Roger Dean, see this. Bold', 'markup gone, text kept', parts.map((p) => p.text).join(''))
ok(noteParts(null).length === 0, 'no notes, no parts')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
