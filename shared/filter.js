/**
 * Narrowing the collection by what's on the records. Within one kind any choice will
 * do (Prog Rock or Jazz); across kinds every one must hold (and from 1970–75).
 *
 *   filter: { genres: [], styles: [], labels: [], people: [personIndex], from, to }
 *
 * The year is the original release year where Discogs has one, else the pressing's.
 */

export const KINDS = ['genres', 'styles', 'labels', 'people']

export const EMPTY_FILTER = { genres: [], styles: [], labels: [], people: [], from: null, to: null }

export const yearOf = (rec) => rec.originalYear || rec.year || null

export function isEmpty(f) {
  return KINDS.every((k) => !f[k].length) && f.from == null && f.to == null
}

function valuesOf(rec, kind) {
  switch (kind) {
    case 'genres':
      return rec.genres || []
    case 'styles':
      return rec.styles || []
    case 'labels':
      return rec.label ? [rec.label] : []
    case 'people':
      return (rec.people || []).map(([i]) => i)
  }
}

/** Does the record pass, leaving one kind out of the test (for that kind's counts). */
export function matches(rec, f, except = null) {
  for (const kind of KINDS) {
    if (kind === except || !f[kind].length) continue
    const have = valuesOf(rec, kind)
    if (!f[kind].some((v) => have.includes(v))) return false
  }
  if (except !== 'year' && (f.from != null || f.to != null)) {
    const y = yearOf(rec)
    if (y == null) return false
    if (f.from != null && y < f.from) return false
    if (f.to != null && y > f.to) return false
  }
  return true
}

/**
 * How many records each choice of one kind would give, alongside the other kinds
 * already chosen. Choices already picked are counted even when they'd now give none,
 * so they can still be seen and taken off.
 */
export function counts(records, f, kind) {
  const n = new Map()
  for (const rec of records) {
    if (!matches(rec, f, kind)) continue
    for (const v of valuesOf(rec, kind)) n.set(v, (n.get(v) || 0) + 1)
  }
  for (const v of f[kind]) if (!n.has(v)) n.set(v, 0)
  return n
}

export function toggle(f, kind, value) {
  const has = f[kind].includes(value)
  return { ...f, [kind]: has ? f[kind].filter((v) => v !== value) : [...f[kind], value] }
}
