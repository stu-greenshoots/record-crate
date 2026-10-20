/**
 * A record's sides from its Discogs track list: what the turntable flips through, and
 * what a touch on the grooves is measured against.
 *
 * Discogs numbers vinyl tracks by side (A1, A2, B1…, or just A and B on a single).
 * A box set's bonus CD or DVD (CD1-1, DVD-1) isn't a side. A list numbered 1, 2, 3
 * can't be put on sides, so the record gets two sides a disc and no tracks on them.
 */

const OTHER_MEDIA = /^(CD|DVD|BD|BR|VHS)/i

/** "8:43" or "1:02:03" in seconds, or null. */
export function seconds(duration) {
  const parts = String(duration || '').trim().split(':')
  if (parts.length < 2 || parts.some((p) => !/^\d+$/.test(p))) return null
  return parts.reduce((t, p) => t * 60 + Number(p), 0)
}

/**
 *   tracklist: Discogs' [{ position, title, duration, type }]
 *   discs: how many records are in the package, for a list that names no sides
 *   -> [{ side: 'A', tracks: [{ position, title, seconds }] }, …] in the order listed
 */
export function sides(tracklist = [], discs = 1) {
  const bySide = new Map()
  for (const t of tracklist) {
    const pos = String(t.position || '').trim()
    if (OTHER_MEDIA.test(pos)) continue
    const side = /^([A-Z]{1,2})(?=\d|[.\s-]|$)/.exec(pos)?.[1]
    if (!side) continue
    if (!bySide.has(side)) bySide.set(side, [])
    bySide.get(side).push({ position: pos, title: t.title || '', seconds: seconds(t.duration) })
  }
  const out = [...bySide].map(([side, tracks]) => ({ side, tracks }))
  // Fewer than two sides named: fill up to two a disc with the letters that follow.
  const want = Math.max(2, discs * 2)
  if (out.length < 2) {
    for (let code = 65; out.length < want; code++) {
      const side = String.fromCharCode(code)
      if (!bySide.has(side)) out.push({ side, tracks: [] })
    }
  }
  return out
}
