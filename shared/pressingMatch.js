/**
 * Which pressing is in your hands, from what the photos gave up.
 *
 * Discogs separates pressings almost entirely by their matrix etchings — the
 * catalogue number names the album, the deadwax names the pressing. So the
 * runout read is worth more than every other signal combined, and the other
 * signals (catalogue number, country, year) exist to break ties and to carry
 * the ranking when no etching survived the camera.
 *
 * Pure functions only: no I/O, no fetching. The caller brings the release
 * shortlist (with each release's `identifiers` where it has them) and whatever
 * the photo reads produced.
 */

import { runouts } from './pressing.js'

/** An etching stripped to the characters that identify it. */
export function normaliseEtching(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function levenshtein(a, b) {
  if (a === b) return 0
  const rows = a.length + 1
  const cols = b.length + 1
  let prev = Array.from({ length: cols }, (_, j) => j)
  for (let i = 1; i < rows; i++) {
    const row = [i]
    for (let j = 1; j < cols; j++) {
      row.push(Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      ))
    }
    prev = row
  }
  return prev[cols - 1]
}

/**
 * How well an OCR'd etching matches a known matrix line, 0..1, or null when
 * they are not the same etching.
 *
 * Thresholds, and why they sit where they do:
 *  - containment is 0.95, not 1: Discogs transcribes the whole line
 *    ("YEX 637-2 Random Machine-stamped") where a photo catches a fragment,
 *    so one being inside the other is a near-certain match but not a byte match.
 *  - fuzzy matches are accepted down to 0.75 similarity (a quarter of the
 *    characters wrong). Below that, deadwax OCR noise produces coincidental
 *    overlaps faster than real matches, measured informally against the
 *    collection's own runouts — anything looser ranked wrong pressings above
 *    right ones.
 */
export function etchingSimilarity(read, known) {
  const a = normaliseEtching(read)
  const b = normaliseEtching(known)
  if (a.length < 4 || b.length < 4) return null
  if (a === b) return 1
  if (a.includes(b) || b.includes(a)) return 0.95
  const distance = levenshtein(a, b)
  const similarity = 1 - distance / Math.max(a.length, b.length)
  return similarity >= 0.75 ? similarity : null
}

/** Every matrix line a release declares, flattened from the variant grouping. */
function matrixLines(release) {
  return runouts(release).flatMap((v) => v.sides.map((s) => s.value))
}

function bestEtchingMatch(readValues, release) {
  let best = null
  for (const read of readValues) {
    for (const known of matrixLines(release)) {
      const score = etchingSimilarity(read, known)
      if (score !== null && (!best || score > best.score)) best = { read, known, score }
    }
  }
  return best
}

function catnoOf(release) {
  return release.catno || (release.labels || []).map((l) => l.catno).find(Boolean) || null
}

function normaliseCatno(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

/**
 * Weights. The runout dominates by design (see the module note); the catalogue
 * number is next because it is printed rather than scratched and so reads
 * reliably; year and country are hints only — Discogs years are missing or
 * approximate often enough that they must never outvote a physical marker.
 */
const WEIGHT = { runout: 0.6, catno: 0.25, year: 0.1, country: 0.05 }

/**
 * Rank a shortlist of releases against the extracted signals.
 *
 * signals: {
 *   runouts:  OCR'd etching strings, best first
 *   catno:    catalogue number read off the sleeve or label
 *   year:     a year hinted by any photo (© line, label print)
 *   country:  a country hinted the same way
 * }
 *
 * Every candidate comes back (the caller chooses how many to show), scored
 * 0..1, with the evidence that scored it and — where the top is a near tie —
 * what to look for on the record to split the contenders.
 */
export function rankPressings(releases, signals = {}) {
  const reads = (signals.runouts || []).filter(Boolean)

  const ranked = (releases || []).map((release) => {
    const matched = { runout: null, catno: null, year: null, country: null }
    let score = 0

    if (reads.length) {
      matched.runout = bestEtchingMatch(reads, release)
      if (matched.runout) score += WEIGHT.runout * matched.runout.score
    }

    const catno = catnoOf(release)
    if (signals.catno && catno) {
      const same = normaliseCatno(signals.catno) === normaliseCatno(catno)
      if (same) {
        matched.catno = { read: signals.catno, known: catno }
        score += WEIGHT.catno
      }
    }

    const year = release.year || Number(String(release.released || '').slice(0, 4)) || null
    if (signals.year && year && Number(signals.year) === year) {
      matched.year = year
      score += WEIGHT.year
    }

    if (signals.country && release.country &&
        String(signals.country).toLowerCase() === String(release.country).toLowerCase()) {
      matched.country = release.country
      score += WEIGHT.country
    }

    return {
      releaseId: release.releaseId || release.id,
      title: release.title || null,
      year,
      country: release.country || null,
      catno,
      score: Math.round(score * 100) / 100,
      matched,
      hasMatrix: matrixLines(release).length > 0,
      distinguishers: [],
    }
  })

  ranked.sort((a, b) => b.score - a.score)

  // Without a runout the ranking rests on printed details several pressings
  // share, so say so rather than let a 0.4 look like a verdict.
  const overall = reads.length && ranked[0]?.matched.runout
    ? 'runout'
    : ranked.some((r) => r.score > 0) ? 'printed-details-only' : 'none'

  // A near tie at the top: tell the owner which etching settles it. The
  // distinguisher for each contender is a matrix line of its own that the
  // other contender doesn't carry.
  const contenders = ranked.filter((r) => ranked[0] && ranked[0].score - r.score < 0.05 && r.score > 0)
  if (contenders.length > 1) {
    for (const c of contenders) {
      const release = (releases || []).find((r) => (r.releaseId || r.id) === c.releaseId)
      const others = contenders.filter((o) => o !== c).flatMap((o) => {
        const rel = (releases || []).find((r) => (r.releaseId || r.id) === o.releaseId)
        return rel ? matrixLines(rel).map(normaliseEtching) : []
      })
      c.distinguishers = matrixLines(release || {})
        .filter((line) => !others.includes(normaliseEtching(line)))
        .slice(0, 3)
        .map((line) => `An etching reading “${line}” points to this pressing`)
    }
  }

  return { candidates: ranked, confidence: overall }
}
