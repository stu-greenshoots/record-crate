/**
 * Your record's tracks, found on Spotify. The album there may be a remaster with
 * "- Remastered 2009" on every title, a deluxe edition with extra tracks, or a
 * different cut altogether, so tracks are lined up in order by title, with length as
 * the tie-breaker, and an album that doesn't line up isn't played at all.
 */
import { titleKey } from './discography.js'

// Below this share of tracks matched, it's not the record: play nothing.
export const GOOD_ENOUGH = 0.6

function pairScore(want, got) {
  const a = titleKey(want.title)
  const b = titleKey(got.name)
  const close = want.seconds != null && Math.abs(want.seconds - got.duration_ms / 1000) <= 8
  if (a && a === b) return close || want.seconds == null ? 2 : 1.5
  if (a && b && (a.startsWith(b) || b.startsWith(a))) return close ? 1.5 : 1
  return close ? 0.6 : 0
}

/**
 * Discogs tracks [{ title, seconds }] against Spotify's [{ name, duration_ms, uri }],
 * both in playing order: the best in-order pairing (an alignment, so extra tracks on
 * either side are skipped).
 *   -> { uris, seconds: one each per Discogs track, or null; score: share of tracks matched }
 */
export function align(want, got) {
  const n = want.length
  const m = got.length
  const best = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      const p = pairScore(want[i], got[j])
      best[i][j] = Math.max(best[i + 1][j], best[i][j + 1], p > 0 ? p + best[i + 1][j + 1] : 0)
    }
  }
  const uris = new Array(n).fill(null)
  const seconds = new Array(n).fill(null)
  let matched = 0
  for (let i = 0, j = 0; i < n && j < m; ) {
    const p = pairScore(want[i], got[j])
    if (p > 0 && best[i][j] === p + best[i + 1][j + 1]) {
      uris[i] = got[j].uri
      seconds[i] = Math.round(got[j].duration_ms / 1000)
      matched++
      i++
      j++
    } else if (best[i][j] === best[i + 1][j]) i++
    else j++
  }
  return { uris, seconds, score: n ? matched / n : 0 }
}

/** Of several albums [{ id, tracks }], the one that lines up best, if any is good enough. */
export function bestAlbum(albums, want) {
  let best = null
  for (const album of albums) {
    const sorted = [...album.tracks].sort((a, b) => a.disc_number - b.disc_number || a.track_number - b.track_number)
    const a = align(want, sorted)
    if (a.score >= GOOD_ENOUGH && (!best || a.score > best.score)) best = { ...album, ...a }
  }
  return best
}
