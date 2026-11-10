/**
 * Where the needle is: a touch on the record as a track and a time, and back.
 *
 * Radii are fractions of the record's radius. The groove is cut at a steady pitch, so
 * time into a side runs evenly from the lead-in at the edge to the run-out by the
 * label. Close enough to put a finger on a track; real records vary with level and
 * length, so a touch just past a gap snaps to the start of that track.
 */

// The label's size as a fraction of the record's: 4" on a 12" or 10", 3½" on a 7".
const LABEL = { 7: 0.5, 10: 0.4, 12: 0.357 }

// A touch this close past the start of a track (as a fraction of the side) starts it.
const SNAP = 0.012

export function grooves(inches = 12) {
  const label = inches <= 7 ? LABEL[7] : inches <= 10 ? LABEL[10] : LABEL[12]
  // The run-out groove sits between the last track and the label.
  return { outer: 0.96, inner: label + 0.05 }
}

// A typical LP side, for a track list with no lengths at all.
const SIDE = 20 * 60

/** Each track's length in seconds; a missing one is the average of the rest. */
export function lengths(side) {
  const known = side.tracks.map((t) => t.seconds).filter((s) => s > 0)
  const fill = known.length ? known.reduce((a, b) => a + b, 0) / known.length : SIDE / Math.max(1, side.tracks.length)
  return side.tracks.map((t) => (t.seconds > 0 ? t.seconds : fill))
}

/** The side with lengths filled in from elsewhere (Spotify's), where Discogs has none. */
export function withLengths(side, seconds) {
  return { ...side, tracks: side.tracks.map((t, i) => (t.seconds > 0 || !(seconds[i] > 0) ? t : { ...t, seconds: seconds[i] })) }
}

/** The track and seconds into it at radius r, or null off the playing surface. */
export function timeAt(r, side, span) {
  if (!side.tracks.length || r < span.inner) return null
  const lens = lengths(side)
  const total = lens.reduce((a, b) => a + b, 0)
  const f = Math.min(1, (span.outer - Math.min(r, span.outer)) / (span.outer - span.inner))
  let at = f * total
  for (let i = 0; i < lens.length; i++) {
    if (at < lens[i] || i === lens.length - 1) {
      const offset = at / total < SNAP ? 0 : Math.min(at, lens[i])
      return { track: i, offset }
    }
    at -= lens[i]
  }
  return null
}

/** The radius the needle sits at, some seconds into a track. */
export function radiusAt(track, offset, side, span) {
  const lens = lengths(side)
  const total = lens.reduce((a, b) => a + b, 0)
  const before = lens.slice(0, track).reduce((a, b) => a + b, 0)
  return span.outer - ((before + Math.min(offset, lens[track] ?? 0)) / total) * (span.outer - span.inner)
}

/**
 * Where a tone arm of length len, pivoting at (px, py), puts its needle down on the
 * groove of radius r round the spindle at (cx, cy): of the two places its swing
 * crosses that groove, the higher one, which is the part of the record on show.
 * -> { x, y }, or null if the arm can't reach.
 */
export function reach(px, py, len, cx, cy, r) {
  const dx = cx - px
  const dy = cy - py
  const d = Math.hypot(dx, dy)
  if (!d || d > len + r || d < Math.abs(len - r)) return null
  const a = (len * len - r * r + d * d) / (2 * d)
  const h = Math.sqrt(Math.max(0, len * len - a * a))
  const mx = px + (a * dx) / d
  const my = py + (a * dy) / d
  const one = { x: mx + (h * dy) / d, y: my - (h * dx) / d }
  const two = { x: mx - (h * dy) / d, y: my + (h * dx) / d }
  return one.y < two.y ? one : two
}

/**
 * The arm's angle in degrees, from its pivot to the needle, kept between 0 and 360.
 * It never points right, so it never wraps: atan2's jump from 180 to -180 as the arm
 * swings past pointing left would make a CSS transition spin it the long way round.
 */
export function armAngle(px, py, at) {
  const a = (Math.atan2(at.y - py, at.x - px) * 180) / Math.PI
  return a < 0 ? a + 360 : a
}
