import type { BuiltMap, Cube, Rec, Spot } from './types'

/**
 * Turning a cube and a position into words you can act on standing in front of the
 * unit: "Top row, 3rd from left" and "about a third of the way in" beat "cube 2,
 * position 23" every time.
 */

const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th']
export const ordinal = (n: number) => ORD[n - 1] || `${n}th`

export function rowName(row: number, rows: number) {
  if (rows === 1) return ''
  if (row === 0) return 'Top row'
  if (row === rows - 1) return 'Bottom row'
  if (rows === 3) return 'Middle row'
  return `${ordinal(row + 1)} row down`
}

export function cubePlace(cube: Cube, built: BuiltMap) {
  const row = rowName(cube.row, built.rows)
  const col = built.cols === 1 ? '' : cube.col === 0 ? 'far left' : cube.col === built.cols - 1 ? 'far right' : `${ordinal(cube.col + 1)} from left`
  return [row, col].filter(Boolean).join(', ')
}

/**
 * How far along the cube a record stands, measured in shelf width rather than
 * headcount — a box set halfway along the count is not halfway along the shelf.
 */
export function fractionAlong(spot: Spot, byId: Map<number, Rec>) {
  let before = 0
  let total = 0
  spot.cube.instanceIds.forEach((id, i) => {
    const w = byId.get(id)?.width ?? 1
    if (i < spot.index) before += w
    if (i === spot.index) before += w / 2
    total += w
  })
  return total ? before / total : 0
}

export function alongWords(f: number, count: number) {
  if (count <= 1) return 'on its own'
  if (f < 0.12) return 'right at the left end'
  if (f < 0.26) return 'near the left end'
  if (f < 0.42) return 'about a third of the way in'
  if (f < 0.58) return 'about halfway along'
  if (f < 0.74) return 'about two-thirds of the way in'
  if (f < 0.88) return 'near the right end'
  return 'right at the right end'
}

export const yearOf = (r: Rec) => r.originalYear || r.year || null
