import { discography, kindOf, titleKey } from '../shared/discography.js'

let pass = 0, fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}

const g = (id, title, date, primary, secondary = [], masters = []) => ({ id, title, date, primary, secondary, masters })

ok(kindOf(g('', '', '', 'Album')) === 'album', 'a plain album')
ok(kindOf(g('', '', '', 'Album', ['Soundtrack'])) === 'album', 'a soundtrack album counts as an album')
ok(kindOf(g('', '', '', 'Album', ['Live'])) === 'live', 'live album')
ok(kindOf(g('', '', '', 'Broadcast', ['Live'])) === 'live', 'a live broadcast is live')
ok(kindOf(g('', '', '', 'Album', ['Compilation', 'Live'])) === 'comp', 'a live compilation is a compilation')
ok(kindOf(g('', '', '', 'EP', ['Live'])) === 'ep', 'a live EP is an EP')
ok(kindOf(g('', '', '', 'Album', ['Remix'])) === 'other' && kindOf(g('', '', '', 'Other', ['Interview'])) === 'other', 'remixes and interviews are other')
ok(kindOf(g('', '', '', null)) === 'other', 'no type is other')

ok(titleKey('Angel’s Egg: Radio Gnome Invisible, Part 2') === titleKey("Angel's Egg (Radio Gnome Invisible Part II)"), 'subtitles and brackets dropped')
ok(titleKey('Camembert Électrique') === titleKey('Camembert Electrique'), 'accents folded')
ok(titleKey('The Power And The Glory') === titleKey('Power & the Glory'), 'leading The and & folded')
ok(titleKey('Re-Ac-Tor') !== titleKey('Re'), 'a hyphen inside a word is kept')
ok(titleKey('Live Vol. 1') !== titleKey('Live Vol. 2'), 'volume numbers kept')

const groups = [
  g('flying', 'Flying Teapot: Radio Gnome Invisible, Part 1', '1973-05-25', 'Album', [], [27681]),
  g('angel', 'Angel’s Egg: Radio Gnome Invisible, Part 2', '1973-12-07', 'Album', [], [27664]),
  g('you', 'You', '1974-10-04', 'Album'),
  g('sheffield', 'Live at Sheffield ’74', '1990-08-13', 'Album', ['Live'], [27854]),
  g('bataclan', 'Live au Bataclan 1973', '1990', 'Album', ['Live']),
  g('best', 'The Best of Gong', '2000', 'Album', ['Compilation']),
  g('you-comp', 'You', '1975', 'Album', ['Compilation']),
  g('single', 'Garçon ou fille', '1970', 'Single'),
  g('single-owned', 'Est-ce que je suis', '1970', 'Single', [], [99]),
  g('remix', 'You Remixed', '1997', 'Album', ['Remix']),
]
const records = [
  { id: 1, masterId: 27681, title: 'Flying Teapot (Radio Gnome Invisible Part 1)', originalYear: 1973 },
  { id: 2, masterId: 27664, title: "Angel's Egg", originalYear: 1973 },
  { id: 3, masterId: 27664, title: "Angel's Egg", originalYear: 1973 },
  { id: 4, masterId: 5555, title: 'You', originalYear: 1974 },
  { id: 5, masterId: 27854, title: 'Live! At Sheffield 1974', originalYear: 1990 },
  { id: 6, masterId: 99, title: 'Est-Ce Que Je Suis', originalYear: 1970 },
  { id: 7, masterId: 777, title: 'Shamal', originalYear: 1975 },
  { id: 8, masterId: null, title: 'You', originalYear: 1990 },
]
const d = discography(groups, records)
const own = (id) => d.albums.find((a) => a.id === id)?.own.join(',')
ok(own('flying') === '1', 'matched by Discogs master')
ok(own('angel') === '2,3', 'two copies of one album both match it')
ok(own('you') === '4', 'matched by title and year when there is no master link, to the album not the compilation', JSON.stringify(d.albums.find((a) => a.id === 'you-comp')))
ok(own('sheffield') === '5', 'a differently titled live album matches by master')
ok(own('single-owned') === '6', 'an owned single is listed')
ok(!d.albums.some((a) => a.id === 'single') && !d.albums.some((a) => a.id === 'remix'), 'unowned singles and remixes are left out')
ok(d.unmatched.join(',') === '7,8', 'records matching nothing come back, including a title match too many years out', d.unmatched.join(','))
ok(d.counts.album.have === 3 && d.counts.album.total === 3, 'studio albums counted', JSON.stringify(d.counts))
ok(d.counts.live.have === 1 && d.counts.live.total === 2, 'live albums counted separately')
ok(d.albums.map((a) => a.year).join(',') === '1970,1973,1973,1974,1975,1990,1990,2000', 'oldest first', d.albums.map((a) => a.year).join(','))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
