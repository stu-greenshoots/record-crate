/**
 * An artist's albums from MusicBrainz, matched against the records you own. Studio
 * and live albums are what's counted as "missing"; compilations and EPs are listed
 * but not counted; singles and the rest (interviews, remixes, demos) only show when
 * you own one.
 */

const OTHER = new Set(['Interview', 'Audiobook', 'Spokenword', 'Remix', 'DJ-mix', 'Mixtape/Street', 'Demo', 'Audio drama', 'Field recording'])

export const COUNTED = ['album', 'live']

/** album | live | ep | comp | single | other */
export function kindOf(group) {
  const sec = group.secondary || []
  if (sec.includes('Compilation')) return 'comp'
  if (sec.some((s) => OTHER.has(s))) return 'other'
  if (group.primary === 'Single') return 'single'
  if (group.primary === 'EP') return 'ep'
  if (sec.includes('Live')) return 'live'
  if (group.primary === 'Album') return 'album'
  return 'other'
}

/** A title reduced to what two spellings of the same album share. */
export function titleKey(title) {
  return String(title)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, ' ')
    .replace(/\s*:.*$/, '')
    .replace(/\s[–—-]\s.*$/, '')
    .replace(/&/g, 'and')
    .replace(/^the\s+/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

const yearOf = (s) => {
  const m = String(s ?? '').match(/\d{4}/)
  return m ? Number(m[0]) : null
}

/**
 * The artist's albums, oldest first, each with the ids of your records that are it.
 *
 *   groups: [{ id, title, date, primary, secondary, masters }] (as fetched)
 *   records: your records by this artist ({ id, masterId, title, originalYear, year })
 *   -> { albums: [{ id, title, year, kind, own }], counts: { album, live }, unmatched }
 *
 * A record matches by its Discogs master where MusicBrainz links one, else by title
 * and year. Records that match nothing are returned as unmatched, so the page can
 * still show them.
 */
export function discography(groups, records) {
  const byMaster = new Map()
  for (const g of groups) for (const m of g.masters || []) byMaster.set(m, g.id)
  const own = new Map(groups.map((g) => [g.id, []]))
  const unmatched = []
  for (const r of records) {
    let id = r.masterId ? byMaster.get(r.masterId) : null
    if (!id) {
      const key = titleKey(r.title)
      const year = r.originalYear || r.year
      const candidates = groups.filter((g) => {
        const gy = yearOf(g.date)
        return key && titleKey(g.title) === key && (!year || !gy || Math.abs(gy - year) <= 2)
      })
      // Prefer the studio album over a compilation sharing its name.
      candidates.sort((a, b) => Number(COUNTED.includes(kindOf(b))) - Number(COUNTED.includes(kindOf(a))))
      id = candidates[0]?.id || null
    }
    if (id) own.get(id).push(r.id)
    else unmatched.push(r.id)
  }

  const albums = groups
    .map((g) => ({ id: g.id, title: g.title, year: yearOf(g.date), kind: kindOf(g), masters: g.masters || [], own: own.get(g.id) }))
    .filter((a) => a.own.length || !['single', 'other'].includes(a.kind))
    .sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title))

  const counts = {}
  for (const k of COUNTED) {
    const list = albums.filter((a) => a.kind === k)
    counts[k] = { have: list.filter((a) => a.own.length).length, total: list.length }
  }
  return { albums, counts, unmatched }
}
