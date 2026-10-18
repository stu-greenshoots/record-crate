import { cutters, noteParts, physical, runouts, verdict } from '../shared/pressing.js'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}

const lp = (descriptions, text = null) => [{ name: 'Vinyl', qty: '1', descriptions, text }]
const rel = (o) => ({ year: null, released: null, country: null, formats: lp(['LP', 'Album']), ...o })
const v = (released, country) => ({ released, country })

// Abbey Road: dozens of countries in 1969, mostly with just a year.
const abbey = [v('1969', 'Italy'), v('1969-09-26', 'UK'), v('1969', 'UK'), v('1969', 'US'), v('1970', 'Japan'), v('1987', 'UK')]
let out = verdict(rel({ year: 1969, country: 'UK' }), abbey, 1969)
ok(out.kind === 'original' && out.text === 'Original UK pressing', 'a first-year pressing is an original', JSON.stringify(out))
ok(/2 UK pressings from 1969/.test(out.detail), 'says how many first-year pressings share its country', out.detail)
ok(out.origin === 'UK', 'a full date settles which country was first')

out = verdict(rel({ year: 1969, country: 'Italy' }), abbey, 1969)
ok(out.kind === 'original' && /very first release was in UK/.test(out.detail), 'a same-year pressing elsewhere is still original, and says where the first was', JSON.stringify(out))

const yearsOnly = [v('1971', 'France'), v('1971', 'UK'), v('1971', 'UK')]
out = verdict(rel({ year: 1971, country: 'UK' }), yearsOnly, 1971)
ok(out.origin === null && !/very first/.test(out.detail || ''), "with only years, it doesn't guess which country was first", JSON.stringify(out))

out = verdict(rel({ year: 1963, country: 'UK', formats: lp(['LP', 'Album', 'Repress', 'Mono']) }), [v('1963-03-22', 'UK')], 1963)
ok(out.kind === 'repress' && out.text === '1963 repress', 'a same-year repress is not the original')

out = verdict(rel({ year: 1972, country: 'UK', formats: lp(['LP', 'Album', 'Repress', 'Stereo']) }), [v('1969', 'UK'), v('1972', 'UK')], 1969)
ok(out.kind === 'repress' && out.text === '1972 repress' && /first came out in 1969/.test(out.detail), 'a later repress says repress, not reissue', JSON.stringify(out))

out = verdict(rel({ year: 1994, country: 'Ghana', formats: [{ name: 'Cassette', qty: '1', descriptions: [] }] }), [v('2015', 'US')], 1994)
ok(out.kind === 'original' && out.text === 'Original Ghana cassette', 'a cassette original is a cassette, not a pressing', JSON.stringify(out))

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

out = verdict(rel({ year: 2015, country: 'UK' }), [v('2015', 'UK'), v('2020', 'UK')], 1995)
ok(out.kind === 'first-vinyl' && /1995/.test(out.detail), 'the earliest vinyl of an older album is its first on vinyl', JSON.stringify(out))

out = verdict(rel({ year: 2015, country: 'US', formats: lp(['LP', 'Reissue', 'Unofficial Release']) }), [v('1967', 'US')], 1967)
ok(out.kind === 'unofficial', 'bootlegs are called out before anything else')

out = verdict(rel({ year: null, country: 'France' }), [v('1974', 'France')], 1974)
ok(out.kind === 'unknown', 'no year, no verdict')

out = verdict(rel({ year: 1975, country: 'US', formats: lp(['LP', 'Album', 'Promo']) }), [v('1975', 'US')], 1975)
ok(out.kind === 'original' && out.promo, 'a promo of the original is an original, marked promo')

out = verdict(rel({ year: 1994, country: 'Ghana' }), [], null)
ok(out.kind === 'original' && out.versions === 0, 'an album with no other versions listed')

out = verdict(rel({ released: 'Mar 1978', country: 'US' }), [v('1978', 'US')], 1978)
ok(out.kind === 'original', 'reads the year from a written-out release date')

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
