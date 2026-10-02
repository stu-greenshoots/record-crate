/**
 * How much shelf a record actually eats.
 *
 * Counting sleeves treats a 1970s single LP and a 180-gram gatefold double as the
 * same object, which they very much aren't. Everything here is expressed in
 * "standard LP equivalents" — 1.0 is one single LP in a plain sleeve, roughly 5mm —
 * so a cube's capacity stays a number of records rather than a measurement.
 *
 * Discogs also publishes `estimated_weight` per release, which is a better signal
 * than any of this; where we have it, it wins.
 */

/** Grams of a plain single LP, used to convert Discogs' weight to our units. */
const GRAMS_PER_LP = 230

const MEDIA = [
  [/box\s*set/i, 3.2],
  [/^vinyl$/i, 1.0],
  [/^cassette$/i, 0.28],
  [/^cd$/i, 0.4],
  [/^file$/i, 0],
  [/^dvd|blu-?ray/i, 0.35],
]

const SIZE = [
  [/^7"$/, 0.3],
  [/^10"$/, 0.65],
  [/^12"$/, 1.0],
]

/**
 * @param {object} info trimmed basic_information for the record
 * @param {number|null} estimatedWeight grams, from the full release where known
 */
export function shelfWidth(info, estimatedWeight = null) {
  const formats = info.formats || []
  if (!formats.length) return 1

  let total = 0
  for (const f of formats) {
    const descriptions = (f.descriptions || []).map((d) => String(d))
    const text = String(f.text || '')
    const blob = `${descriptions.join(' ')} ${text}`

    // Base width of a single unit of this medium.
    let unit = MEDIA.find(([re]) => re.test(f.name || ''))?.[1]
    if (unit === undefined) unit = 1
    const size = SIZE.find(([re]) => descriptions.some((d) => re.test(d)))?.[1]
    if (size !== undefined && /vinyl/i.test(f.name || '')) unit = size

    // Extra discs share one sleeve, so they add vinyl but not another jacket.
    const qty = Math.max(1, Number(f.qty) || 1)
    let width = unit + (qty - 1) * unit * 0.85

    if (/gatefold/i.test(blob)) width += 0.35
    if (/box\s*set/i.test(blob)) width += 1.5
    if (/(180|200)\s*-?\s*(gram|g\b)/i.test(blob)) width += 0.2
    // A single-sided or flexi disc is barely there.
    if (/single sided|flexi/i.test(blob)) width -= 0.15

    total += Math.max(0.1, width)
  }

  if (estimatedWeight && estimatedWeight > 40) {
    // Discogs' weight covers the whole package; blend it with the format estimate so
    // one odd community figure can't put a record wildly out of scale.
    const fromWeight = estimatedWeight / GRAMS_PER_LP
    total = total * 0.4 + fromWeight * 0.6
  }

  return Math.round(Math.max(0.15, total) * 100) / 100
}

/**
 * How tall a record stands, relative to a 12" LP sleeve (about 31.5cm).
 *
 * A 7" single is barely more than half the height of an LP, and on a real shelf it
 * looks it — so the spines are drawn short rather than pretending everything is the
 * same size.
 */
const HEIGHTS = [
  [/^7"$/, 0.57],
  [/^10"$/, 0.82],
  // Discogs describes a 12" album as "LP" and only uses 12" for singles and EPs.
  [/^(12"|LP)$/, 1],
]

const MEDIA_HEIGHT = [
  [/^cassette$/i, 0.35],
  [/^cd$/i, 0.4],
  [/^dvd|blu-?ray/i, 0.42],
  [/^file$/i, 0],
]

export function shelfHeight(info) {
  const formats = info.formats || []
  const f = formats[0]
  if (!f) return 1

  const descriptions = formats.flatMap((x) => (x.descriptions || []).map(String))
  const blob = formats.map((x) => `${x.name || ''} ${(x.descriptions || []).join(' ')} ${x.text || ''}`).join(' ')

  // A box set is a different object from a single sleeve — it stands proud of the
  // records either side of it rather than passing for one of them.
  const boxed = /box\s*set/i.test(blob)

  // An LP with a bonus 7" is still an LP-height package, so the largest sleeve
  // present wins rather than whichever descriptor happens to be listed first.
  const sizes = HEIGHTS.filter(([re]) => descriptions.some((d) => re.test(d))).map(([, v]) => v)
  const media = MEDIA_HEIGHT.find(([re]) => re.test(f.name || ''))?.[1]

  /**
   * A box set is a substantial object whatever is inside it, and must never land in
   * the same visual band as a 7" single — a thirteen-disc box read as a row of
   * singles. Vinyl boxes stand slightly proud of the LPs; a CD or DVD box is
   * genuinely shorter, but still clearly taller than a seven.
   */
  if (boxed) {
    if (sizes.length) return Math.min(1.08, Math.max(...sizes) * 1.08)
    return media !== undefined && media < 0.6 ? 0.78 : 1.08
  }

  if (sizes.length) return Math.max(...sizes)
  if (media !== undefined) return media

  // A 7" is often only marked by its speed and the "Single" descriptor.
  if (descriptions.some((d) => /^45 RPM$/i.test(d)) && descriptions.some((d) => /single/i.test(d))) {
    return 0.57
  }
  return 1
}
