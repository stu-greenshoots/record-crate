/**
 * A made-up collection of any size, shaped like the real one, for seeing how the app
 * copes with a big shelf. Every record borrows the format, shelf, genres, sleeve and
 * label of a real one, but the artists, titles and ids are invented, and the same
 * seed always gives the same collection.
 *
 *   node scripts/synth-collection.mjs [n=5000] [--seed 1]
 *     reads public/data/collection.json, writes synthetic/collection-<n>.json
 *
 * Load it with `npm run dev` and ?collection=<n> in the address. It stays out of
 * public/ so that no build can ship it.
 */
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { fileURLToPath } from 'node:url'
import { shelfLetter } from '../shared/shelfmap.js'

/** Ids from here up: well clear of Discogs' own, so they can never meet a real record. */
export const ID_BASE = 9_000_000_000
const RELEASE_BASE = 900_000_000
const ARTIST_BASE = 90_000_000

/** Cubes of a 5x5 unit, and how full a cube is planned to be. */
const PER_UNIT = 25
const FILL = 0.8

function rng(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ONSETS = ['b', 'br', 'c', 'ch', 'cl', 'd', 'dr', 'f', 'fl', 'g', 'gr', 'h', 'j', 'k', 'l', 'm', 'n', 'p', 'pr', 'r', 's', 'sh', 'st', 't', 'tr', 'v', 'w', 'z']
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'a', 'e', 'o', 'ai', 'ou']
const CODAS = ['', '', '', 'n', 'r', 'l', 's', 'm', 'x', 'nd', 'rt', 'ck', 'th']
const FIRST = ['Ada', 'Alan', 'Bea', 'Carl', 'Dora', 'Eli', 'Fay', 'Gus', 'Hal', 'Ida', 'Joe', 'Kit', 'Lou', 'Mae', 'Ned', 'Ona', 'Pat', 'Ray', 'Sal', 'Tom', 'Una', 'Vic', 'Wes', 'Zoe']
const WORDS = ['Night', 'Blue', 'River', 'Glass', 'Echo', 'Garden', 'Silver', 'Morning', 'Fire', 'Dream', 'Stone', 'Light', 'Shadow', 'Ocean', 'Mirror', 'Wild', 'Golden', 'Secret', 'Electric', 'Summer', 'Winter', 'Machine', 'Desert', 'Velvet', 'Lost', 'Distant', 'Sun', 'Moon', 'Heart', 'Road', 'Time', 'Space', 'Island', 'Storm', 'Quiet', 'Return', 'Live', 'Songs', 'Sessions', 'Part', 'One', 'Two']
const ROLES = ['bass', 'drums', 'guitar', 'vocals', 'keyboards', 'saxophone', 'engineer', 'producer', 'mastered by', 'percussion']

/**
 * Build a collection of n records from the real snapshot `base`.
 * @returns a snapshot in the same shape as public/data/collection.json
 */
export function synthesize(base, n = 5000, seed = 1) {
  const rand = rng(seed)
  const pick = (list) => list[Math.floor(rand() * list.length)]
  const real = base.records
  const flowShelf = base.shelfMap.flowShelf

  // How many records each real artist has, to draw artists' sizes from.
  const perArtist = new Map()
  for (const r of real) perArtist.set(r.sortName, (perArtist.get(r.sortName) || 0) + 1)
  const sizes = [...perArtist.values()]
  const firstOf = new Map(real.map((r) => [r.sortName, r]))
  const artists = [...firstOf.values()]
  const byShelf = new Map()
  for (const r of real) byShelf.set(r.shelf, [...(byShelf.get(r.shelf) || []), r])
  const sameStyle = (t) => {
    const shelf = byShelf.get(t.shelf)
    const genre = shelf.filter((r) => r.genres[0] === t.genres[0])
    return genre.length > 2 ? genre : shelf
  }

  const word = (start) => {
    let w = start ? start.toLowerCase() : pick(ONSETS)
    if (!/[aeiouy]$/.test(w)) w += pick(VOWELS)
    const extra = rand() < 0.7 ? 1 : 2
    for (let k = 0; k < extra; k++) w += pick(ONSETS) + pick(VOWELS)
    w += pick(CODAS)
    return w[0].toUpperCase() + w.slice(1)
  }
  const used = new Set()
  /** A name filed under the same letter as the real artist it stands in for. */
  const name = (like) => {
    const letter = shelfLetter(like)
    const person = like.sortName.includes(', ') && !/, The$/.test(like.sortName)
    const the = /, The$/.test(like.sortName)
    for (;;) {
      const lead = letter === '#' ? String(1 + Math.floor(rand() * 99)) : null
      const first = lead ? `${lead} ${word()}` : word(letter)
      let artist, sortName
      if (person && !lead) {
        const given = pick(FIRST)
        artist = `${given} ${first}`
        sortName = `${first}, ${given}`
      } else {
        const rest = rand() < 0.5 ? ` ${word()}` : ''
        sortName = `${first}${rest}${the ? ', The' : ''}`
        artist = the ? `The ${first}${rest}` : `${first}${rest}`
      }
      if (!used.has(sortName)) {
        used.add(sortName)
        return { artist, sortName }
      }
    }
  }

  const addedFrom = Math.min(...real.map((r) => Date.parse(r.addedAt)))
  const addedTo = Math.max(...real.map((r) => Date.parse(r.addedAt)))
  const peopleCount = Math.max(1, Math.round(((base.people || []).length / real.length) * n))
  const realCompleteness = Object.values(base.completeness || {})
  const completeShare = Object.keys(base.completeness || {}).length / Math.max(1, artists.length)

  const records = []
  const completeness = {}
  let artistNo = 0
  while (records.length < n) {
    const like = pick(artists)
    const size = Math.min(pick(sizes), n - records.length)
    const { artist, sortName } = name(like)
    const artistId = ARTIST_BASE + artistNo++
    if (realCompleteness.length && rand() < completeShare) completeness[artistId] = [...pick(realCompleteness)]
    const pool = sameStyle(like)
    for (let k = 0; k < size; k++) {
      const t = k === 0 ? like : pick(pool)
      const i = records.length
      const year = t.year ? t.year + Math.round((rand() - 0.5) * 6) : null
      const originalYear = t.originalYear ? Math.min(t.originalYear + Math.round((rand() - 0.5) * 6), year ?? Infinity) : null
      const title = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => pick(WORDS)).join(' ')
      const scale = 0.5 + rand()
      records.push({
        id: ID_BASE + i,
        releaseId: RELEASE_BASE + i,
        title,
        artist,
        credit: artist,
        sortName,
        year,
        originalYear,
        shelf: t.shelf,
        width: t.width,
        height: t.height,
        format: t.format,
        catno: `${sortName.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'SYN'} ${1000 + Math.floor(rand() * 9000)}`,
        label: t.label,
        genres: [...t.genres],
        styles: [...t.styles],
        addedAt: new Date(addedFrom + rand() * (addedTo - addedFrom)).toISOString(),
        cover: t.cover,
        remoteCover: t.remoteCover ?? null,
        people: (t.people || []).map(([, kinds]) => [Math.floor(peopleCount * rand() ** 3), kinds]),
        masterId: RELEASE_BASE + i,
        artistId,
        country: t.country ?? null,
        press: t.press ?? null,
        have: t.have == null ? null : Math.max(1, Math.round(t.have * scale)),
        want: t.want == null ? null : Math.round(t.want * scale),
        value: t.value == null ? null : Math.round(t.value * scale * 100) / 100,
        plant: t.plant ?? null,
        labelArt: t.labelArt ?? null,
        faces: (t.faces || []).map((f) => ({ ...f })),
        colour: t.colour ?? null,
        ...(t.labelDisc != null && { labelDisc: t.labelDisc }),
        ...(t.inches != null && { inches: t.inches }),
      })
    }
  }

  const people = Array.from({ length: peopleCount }, () => [`${pick(FIRST)} ${word()}`, pick(ROLES)])

  return {
    exportedAt: base.exportedAt,
    syncedAt: base.syncedAt,
    username: `synthetic-${n}`,
    shelves: base.shelves.map((s) => ({ ...s })),
    shelfMap: scaleMap(base.shelfMap, records, flowShelf),
    people,
    completeness,
    records,
  }
}

/**
 * Enough 5x5 units for the collection with room to grow, stacked one above the next
 * in a single five-wide grid. The map is one grid filed in slot order, so this keeps
 * the A–Z run going unit by unit. Side by side would run it along the top row of
 * every unit before coming back for the second. Each group of named shelves keeps its
 * one cube (a named shelf can't spill into a second), at the end, as on the real unit.
 * The run is split evenly: "letters" can't give more than 26 cubes a letter each.
 */
export function scaleMap(map, records, flowShelf = map.flowShelf) {
  const groups = map.slots.filter((s) => s.type === 'shelves').map((s) => ({ type: 'shelves', shelfIds: [...(s.shelfIds || [])] }))
  const flowWidth = records.filter((r) => r.shelf === flowShelf).reduce((a, r) => a + (r.width ?? 1), 0)
  const needed = Math.ceil(flowWidth / (map.capacity * FILL)) + groups.length
  const units = Math.max(1, Math.ceil(needed / PER_UNIT))
  const flow = units * PER_UNIT - groups.length
  return {
    cols: 5,
    rows: units * 5,
    capacity: map.capacity,
    flowShelf,
    split: 'even',
    slots: [...Array.from({ length: flow }, () => ({ type: 'flow' })), ...groups],
  }
}

function main() {
  const args = process.argv.slice(2)
  const seedAt = args.indexOf('--seed')
  const seed = seedAt >= 0 ? Number(args.splice(seedAt, 2)[1]) : 1
  const n = Number(args[0] || 5000)
  if (!Number.isInteger(n) || n < 1) throw new Error(`Not a size: ${args[0]}`)
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const base = JSON.parse(fs.readFileSync(path.join(root, 'public/data/collection.json'), 'utf8'))
  const out = path.join(root, `synthetic/collection-${n}.json`)
  fs.mkdirSync(path.dirname(out), { recursive: true })
  const text = JSON.stringify(synthesize(base, n, seed))
  fs.writeFileSync(out, text)
  const kb = (b) => `${Math.round(b / 1024)} KB`
  console.log(`${path.relative(root, out)}: ${n} records, ${kb(text.length)}, ${kb(zlib.gzipSync(text).length)} gzipped`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
