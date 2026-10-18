/**
 * Who is on a record, from its Discogs credits: the people who play on it, engineer
 * it or produce it. Writers, designers, photographers, management and crew are left
 * out, so a filter by person finds records they made the sound of.
 */

export const PLAY = 1
export const ENG = 2
export const PROD = 4

const ENGINEERING = new Set([
  'engineer',
  'recorded by',
  'mixed by',
  'mastered by',
  'remastered by',
  'lacquer cut by',
  'tape op',
  'tracking by',
  'edited by',
  'transferred by',
  'overdubbed by',
  'remix',
  'restoration',
  'field recording',
  'sound designer',
  'recording supervisor',
  'dj mix',
])

const PRODUCTION = new Set([
  'producer',
  'co-producer',
  'executive-producer',
  'executive producer',
  'reissue producer',
  'supervised by',
])

// Everything else Discogs lists is an instrument, a voice or a line-up ("Performer",
// "Band", "Orchestra", "Conductor"), so the roles that aren't are the shorter list.
const NOT_PLAYING = new Set([
  'written-by', 'written by', 'composed by', 'music by', 'lyrics by', 'words by', 'songwriter',
  'arranged by', 'orchestrated by', 'adapted by', 'score', 'score editor', 'copyist',
  'transcription by', 'text by', 'script by', 'compiled by', 'curated by', 'editor',
  'photography by', 'photography', 'design', 'design concept', 'artwork', 'artwork by',
  'art direction', 'illustration', 'cover', 'sleeve', 'painting', 'layout', 'graphics',
  'typography', 'lettering', 'calligraphy', 'drawing', 'logo', 'cgi artist',
  'creative director', 'concept by', 'liner notes', 'sleeve notes',
  'management', 'crew', 'technician', 'other', 'coordinator', 'booking', 'promotion',
  'administrator', 'lighting', 'lighting director', 'equipment', 'public relations',
  'advisor', 'a&r', 'tour manager', 'legal', 'merchandising', 'costume designer',
  'product manager', 'consultant', 'research', 'make-up', 'choreography', 'stage manager',
  'contractor', 'production manager', 'film director', 'film producer', 'stylist',
  'musical assistance', 'realization', 'directed by',
  'interviewer', 'interviewee', 'presenter', 'narrator', 'read by', 'voice actor', 'dialog',
])

/**
 * What a Discogs role string makes someone. One credit can carry several roles,
 * "Producer, Engineer" or "Drums, Percussion"; bracketed detail ("Design [Sleeve]",
 * "Guitar [12-String]") is dropped. Returns the kinds as a bitmask and the playing
 * roles by name, lower case.
 */
export function creditKinds(role) {
  let mask = 0
  const plays = []
  for (const part of String(role || '').replace(/\[[^\]]*\]/g, '').split(',')) {
    const r = part.trim().toLowerCase()
    if (!r) continue
    if (ENGINEERING.has(r)) mask |= ENG
    else if (PRODUCTION.has(r)) mask |= PROD
    else if (!NOT_PLAYING.has(r)) {
      mask |= PLAY
      plays.push(r)
    }
  }
  return { mask, plays }
}

/** Discogs adds " (2)" to tell same-named artists apart. */
export function displayName(name) {
  return String(name).replace(/\s+\(\d+\)$/, '').trim()
}

/**
 * Everyone credited across the collection, once each, keyed by Discogs id.
 *
 *   releases: [{ id, credits, tracklist }] as cached from Discogs
 *   -> people: [[name, roles]]  roles reads like "drums, percussion, producer"
 *      byRelease: { [releaseId]: [[personIndex, mask]] }
 *
 * People are sorted by name so the snapshot is stable between exports.
 */
export function collectPeople(releases) {
  const found = new Map()
  const onRelease = new Map()
  for (const rel of releases) {
    const credits = [...(rel.credits || []), ...(rel.tracklist || []).flatMap((t) => t.credits || [])]
    const here = new Map()
    for (const c of credits) {
      const { mask, plays } = creditKinds(c.role)
      if (!mask || c.id == null) continue
      let p = found.get(c.id)
      if (!p) found.set(c.id, (p = { name: displayName(c.name), mask: 0, plays: new Map() }))
      p.mask |= mask
      // Count a role once per record, so a drummer on every track of one album
      // doesn't outweigh what they did on the rest.
      const seen = here.get(c.id) || { mask: 0, plays: new Set() }
      for (const r of plays) {
        if (!seen.plays.has(r)) p.plays.set(r, (p.plays.get(r) || 0) + 1)
        seen.plays.add(r)
      }
      seen.mask |= mask
      here.set(c.id, seen)
    }
    onRelease.set(rel.id, here)
  }

  const ids = [...found.keys()].sort(
    (a, b) => found.get(a).name.localeCompare(found.get(b).name) || a - b,
  )
  const index = new Map(ids.map((id, i) => [id, i]))
  const people = ids.map((id) => {
    const p = found.get(id)
    // The two roles they're on most records for, skipping near-repeats: "bass", not
    // "bass, bass guitar".
    const roles = []
    for (const [r] of [...p.plays].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      if (roles.length === 2) break
      if (!roles.some((c) => r.includes(c) || c.includes(r))) roles.push(r)
    }
    if (p.mask & ENG) roles.push('engineer')
    if (p.mask & PROD) roles.push('producer')
    return [p.name, roles.join(', ')]
  })
  const byRelease = {}
  for (const [releaseId, here] of onRelease) {
    if (!here.size) continue
    byRelease[releaseId] = [...here].map(([id, s]) => [index.get(id), s.mask]).sort((a, b) => a[0] - b[0])
  }
  return { people, byRelease }
}
