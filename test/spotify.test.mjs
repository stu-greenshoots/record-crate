import { align, bestAlbum } from '../shared/spotify.js'

let pass = 0
let fail = 0
const ok = (cond, label, extra = '') => {
  cond ? pass++ : fail++
  console.log(`${cond ? ' ok ' : 'FAIL'}  ${label}${extra ? `  ${extra}` : ''}`)
}
const d = (title, seconds = null) => ({ title, seconds })
const s = (name, secs, n) => ({ name, duration_ms: secs * 1000, uri: `spotify:track:${n || name}`, disc_number: 1, track_number: n || 1 })

const abbeyA = [d('Come Together', 259), d('Something', 182), d('Maxwell\'s Silver Hammer', 207)]
const remaster = [
  s('Come Together - Remastered 2009', 260, 1),
  s('Something - Remastered 2009', 183, 2),
  s("Maxwell's Silver Hammer - Remastered 2009", 207, 3),
]
let a = align(abbeyA, remaster)
ok(a.uris.join() === 'spotify:track:1,spotify:track:2,spotify:track:3', 'a remaster lines up track for track, suffixes and all', a.uris.join())
ok(a.score === 1, 'and is a full match')

const deluxe = [s('Intro', 30, 1), ...remaster.map((t, i) => ({ ...t, track_number: i + 2 })), s('Come Together - Take 5', 270, 5)]
a = align(abbeyA, deluxe)
ok(a.uris.join() === 'spotify:track:1,spotify:track:2,spotify:track:3' && a.score === 1, 'extra tracks on Spotify are skipped, in order', a.uris.join())

a = align([d('Side One', 1080)], [s('Part 1', 540, 1), s('Part 2', 540, 2)])
ok(a.score < 0.5, "a side-long piece split differently on Spotify doesn't count as a match", String(a.score))

a = align([d('Song A', 200), d('Untitled', 180)], [s('Song A', 200, 1), s('Bonus', 240, 2), s('Something Else', 181, 3)])
ok(a.uris[0] === 'spotify:track:1' && a.uris[1] === 'spotify:track:3', 'an unmatched title still pairs by length when it is within a few seconds', a.uris.join())
ok(a.uris.length === 2, 'one uri per Discogs track')

a = align([d('Nothing Here', 100)], [s('Other', 300, 1)])
ok(a.uris[0] === null && a.score === 0, 'no match is null, not a guess')

const best = bestAlbum([
  { id: 'live', tracks: [s('Come Together (Live)', 300, 1)] },
  { id: 'lp', tracks: remaster },
], abbeyA)
ok(best?.id === 'lp', 'the album whose tracks match best wins')
ok(bestAlbum([{ id: 'x', tracks: [s('Other', 99, 1)] }], abbeyA) === null, 'no good album: none, rather than the wrong music')

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
