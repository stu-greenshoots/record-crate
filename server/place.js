import { collationKey, classifyShelf, deriveSortName, cleanArtistName } from '../shared/classify.js'
import { shelfWidth, shelfHeight } from '../shared/thickness.js'
import { buildShelfMap, shelfLetter, byFiling } from '../shared/shelfmap.js'
import { allRecords } from './records.js'
import { store } from './store.js'

/**
 * Work out exactly where a record goes: which cube, and which two records it slots
 * between. This is the question you actually have standing in front of the shelf
 * with a record in your hand.
 */

/** How records are ordered within a cube, which differs by what the cube holds. */
function comparator(slotType) {
  if (slotType === 'flow') return byFiling
  // Named shelves group by sleeve size first — the 7"s live together.
  return (a, b) => (b.height ?? 1) - (a.height ?? 1) || byFiling(a, b)
}

/**
 * @param {object} candidate a record-shaped object: { sortName, originalYear, title,
 *   height, shelf?, instanceId? }
 * @returns placement, or null if the target shelf isn't on the unit at all
 */
export function placeRecord(candidate) {
  const records = allRecords()
  const map = store.overrides.shelfMap
  const built = buildShelfMap(map, records, store.overrides.shelves)

  // Ignore the record's own current position when re-filing something already held.
  const others = candidate.instanceId
    ? records.filter((r) => r.instanceId !== candidate.instanceId)
    : records
  const rebuilt = candidate.instanceId
    ? buildShelfMap(map, others, store.overrides.shelves)
    : built

  const shelf = candidate.shelf || 'main'
  const cubes = rebuilt.slots.filter((s) =>
    s.type === 'flow' ? shelf === rebuilt.flowShelf : (s.shelfIds || []).includes(shelf),
  )
  if (!cubes.length) return null

  const byId = new Map(others.map((r) => [r.instanceId, r]))
  // The shelf read left to right, cube by cube, exactly as it stands in the room.
  const run = cubes.flatMap((s) =>
    s.instanceIds.map((id) => ({ record: byId.get(id), cube: s })).filter((x) => x.record),
  )

  const compare = comparator(cubes[0].type)
  let index = run.length
  for (let i = 0; i < run.length; i++) {
    if (compare(candidate, run[i].record) <= 0) {
      index = i
      break
    }
  }

  const before = index > 0 ? run[index - 1] : null
  const after = index < run.length ? run[index] : null
  // Slot into the cube of whichever neighbour it sits against.
  const cube = after?.cube || before?.cube || cubes[0]

  const positionInCube = cube.instanceIds.filter((id) => {
    const r = byId.get(id)
    return r && compare(r, candidate) < 0
  }).length

  return {
    shelf,
    shelfName: store.overrides.shelves.find((s) => s.id === shelf)?.name || shelf,
    cube: {
      index: cube.index,
      row: cube.row,
      col: cube.col,
      label: cube.label,
      count: cube.count,
      type: cube.type,
    },
    position: positionInCube + 1,
    before: before ? summarise(before.record, before.cube) : null,
    after: after ? summarise(after.record, after.cube) : null,
    letter: shelfLetter(candidate),
    /** True when it lands at the very start or end of its cube. */
    atCubeStart: !before || before.cube.index !== cube.index,
    atCubeEnd: !after || after.cube.index !== cube.index,
  }
}

function summarise(r, cube) {
  return {
    instanceId: r.instanceId,
    title: r.title,
    artist: r.artist,
    sortName: r.sortName,
    year: r.originalYear || r.year,
    cover: r.thumb || r.cover,
    cubeIndex: cube.index,
    cubeLabel: cube.label,
  }
}

/**
 * Turn a Discogs release into something placeable, using exactly the same filing and
 * shelf rules as the records already on the unit — so a record you don't own yet is
 * placed by the same logic as one you do.
 */
export function candidateFromRelease(release) {
  const artists = release.artists || []
  const primary = artists.find((a) => a.id && a.id !== 194) || artists[0] || null
  const cached = primary?.id ? store.getArtist(primary.id) : null
  const name = cleanArtistName(cached?.name || primary?.name || 'Various')
  const { sortName } = deriveSortName(
    name,
    cached,
    store.overrides.artists[primary?.id ? `id:${primary.id}` : name.toLowerCase()]?.sortName || null,
  )

  const info = {
    title: release.title,
    artist: name,
    formats: (release.formats || []).map((f) => ({
      name: f.name,
      qty: f.qty,
      text: f.text || null,
      descriptions: f.descriptions || [],
    })),
    genres: release.genres || [],
    styles: release.styles || [],
  }

  const master = release.master_id ? store.getMaster(release.master_id) : null
  const shelf = classifyShelf(info)
  const known = store.overrides.shelves.some((s) => s.id === shelf)

  return {
    releaseId: release.id,
    title: release.title,
    artist: name,
    sortName,
    year: release.year || null,
    originalYear: master?.year || release.year || null,
    shelf: known ? shelf : 'main',
    height: shelfHeight(info),
    width: shelfWidth(info, release.estimated_weight ?? null),
    cover: release.images?.[0]?.uri150 || release.thumb || null,
    formats: info.formats,
    country: release.country || null,
    label: release.labels?.[0]?.name || null,
    catno: release.labels?.[0]?.catno || null,
  }
}
