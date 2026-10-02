import { collationKey } from './classify.js'

/**
 * Maps the collection onto the physical furniture — a grid of cubes, each holding
 * either a stretch of the alphabet ("flow" cubes, whose ranges are balanced by how
 * many records you actually own) or one or more named shelves.
 */

export const DEFAULT_MAP = {
  cols: 4,
  rows: 3,
  capacity: 60,
  /** Which shelf feeds the alphabetical run. */
  flowShelf: 'main',
  slots: [
    { type: 'flow' },
    { type: 'flow' },
    { type: 'flow' },
    { type: 'flow' },
    { type: 'flow' },
    { type: 'flow' },
    { type: 'flow' },
    { type: 'flow' },
    { type: 'flow' },
    { type: 'shelves', shelfIds: ['metal'] },
    { type: 'shelves', shelfIds: ['screen'] },
    { type: 'shelves', shelfIds: ['comps', 'singles'] },
  ],
}

/**
 * The order records physically stand in: filed name, then the year the album first
 * came out, then title. This must match the filing order used everywhere else — the
 * unit is a picture of the shelf, so if it disagrees the advice about where to slot
 * a record in is wrong.
 */
export function byFiling(a, b) {
  const an = collationKey(a.sortName)
  const bn = collationKey(b.sortName)
  if (an !== bn) return an < bn ? -1 : 1
  const ay = a.originalYear || a.year || 9999
  const by = b.originalYear || b.year || 9999
  if (ay !== by) return ay - by
  const at = collationKey(a.title)
  const bt = collationKey(b.title)
  return at === bt ? 0 : at < bt ? -1 : 1
}

/** The letter a record files under on the shelf. */
export function shelfLetter(record) {
  const ch = collationKey(record.sortName)[0] || ''
  return /[A-Z]/.test(ch) ? ch : '#'
}

/**
 * Fill the lettered cubes the way you fill a real shelf: run the records in filed
 * order from the first cube to the last and break wherever keeps the cubes evenly
 * loaded, rather than snapping to whole letters.
 *
 * Breaking only on letter boundaries is what produces lopsided cubes — one holding
 * "T – Z" with eleven records beside one holding "A – B" with sixty-five. So a break
 * that lands mid-letter is allowed; it just carries a cost, as does a cube spanning
 * more than three letters. Balance wins when it's worth enough, and the ranges move
 * on their own as the collection grows.
 *
 * @returns {number[][]} one [from, to) slice of `sorted` per cube
 */
function fillCubes(sorted, letters, widths, n, capacity) {
  const N = sorted.length
  if (n <= 1) return [[0, N]]

  // Loads are measured in shelf width, not headcount: a gatefold double takes the
  // room of two thin single LPs and the fill has to reflect that.
  const W = new Float64Array(N + 1)
  for (let k = 0; k < N; k++) W[k + 1] = W[k] + widths[k]

  const mean = W[N] / n
  const maxLoad = Math.max(capacity, mean * 2.2)

  const SPLIT_LETTER = 900 // breaking a letter across two cubes
  const EXTRA_LETTER = 70 // each distinct letter past the third in one cube
  const OVER_CAPACITY = 1000 // per record beyond what the cube physically holds

  // Running count of letter changes, so the distinct letters in a slice is O(1).
  const changes = new Int32Array(N)
  for (let k = 1; k < N; k++) {
    changes[k] = changes[k - 1] + (letters[k] !== letters[k - 1] ? 1 : 0)
  }
  const distinctLetters = (i, j) => (j <= i ? 0 : changes[j - 1] - changes[i] + 1)

  const cost = (i, j) => {
    const load = W[j] - W[i]
    let c = (load - mean) ** 2
    if (load > capacity) c += (load - capacity) * OVER_CAPACITY
    // Charged once per internal boundary, at the cube that starts mid-letter.
    if (i > 0 && i < N && letters[i] === letters[i - 1]) c += SPLIT_LETTER
    const span = distinctLetters(i, j)
    if (span > 3) c += (span - 3) * EXTRA_LETTER
    return c
  }

  const dp = Array.from({ length: n + 1 }, () => new Float64Array(N + 1).fill(Infinity))
  const cut = Array.from({ length: n + 1 }, () => new Int32Array(N + 1))
  dp[0][0] = 0

  for (let j = 1; j <= n; j++) {
    for (let i = 0; i <= N; i++) {
      for (let k = i; k >= 0; k--) {
        // Walking back by width bounds the search without assuming a record size.
        if (k < i && W[i] - W[k] > maxLoad) break
        const prev = dp[j - 1][k]
        if (prev === Infinity) continue
        const c = prev + cost(k, i)
        if (c < dp[j][i]) {
          dp[j][i] = c
          cut[j][i] = k
        }
      }
    }
  }

  const slices = []
  let end = N
  for (let j = n; j >= 1; j--) {
    const from = cut[j][end]
    slices.unshift([from, end])
    end = from
  }
  return slices
}

/**
 * Label a cube by its first and last record. A boundary that splits a letter needs
 * two characters to be meaningful — "S – Sm" then "Sn – Z" — where one that lands on
 * a clean letter break only needs one.
 */
function sliceLabel(sorted, letters, from, to) {
  const N = sorted.length
  if (to <= from) return 'empty'

  const prefix = (index, chars) => {
    const k = collationKey(sorted[index].sortName)
    if (chars === 1 || k.length < 2) return k.slice(0, 1) || '#'
    return k[0] + k.slice(1, 2).toLowerCase()
  }

  const splitStart = from > 0 && letters[from] === letters[from - 1]
  const splitEnd = to < N && letters[to] === letters[to - 1]
  const a = prefix(from, splitStart ? 2 : 1)
  const b = prefix(to - 1, splitEnd ? 2 : 1)
  return a === b ? a : `${a} \u2013 ${b}`
}

/**
 * Build the full picture: every cube with its label, the records standing in it,
 * and whether it's over capacity.
 */
export function buildShelfMap(map, records, shelves) {
  const slots = map.slots.slice(0, map.cols * map.rows)
  const flowIndexes = slots.map((s, i) => (s.type === 'flow' ? i : -1)).filter((i) => i >= 0)

  const flowRecords = records.filter((r) => r.shelf === map.flowShelf).sort(byFiling)

  const flowLetters = flowRecords.map(shelfLetter)
  const flowWidths = flowRecords.map((r) => r.width ?? 1)
  const slices = fillCubes(
    flowRecords,
    flowLetters,
    flowWidths,
    flowIndexes.length || 1,
    map.capacity,
  )

  // Hand each run of records to its cube, in shelf order.
  const byIndex = new Map()
  slices.forEach(([from, to], n) => {
    const slotIndex = flowIndexes[n]
    if (slotIndex === undefined) return
    byIndex.set(slotIndex, {
      items: flowRecords.slice(from, to),
      label: sliceLabel(flowRecords, flowLetters, from, to),
    })
  })

  const shelfNames = new Map(shelves.map((s) => [s.id, s.name]))
  const placed = new Set()

  const built = slots.map((slot, index) => {
    const row = Math.floor(index / map.cols)
    const col = index % map.cols
    let items = []
    let label = ''
    let sublabel = ''

    if (slot.type === 'flow') {
      const range = byIndex.get(index)
      items = range ? range.items : []
      label = range ? range.label : 'empty'
      sublabel = shelfNames.get(map.flowShelf) || ''
    } else {
      const ids = slot.shelfIds || []
      items = records.filter((r) => ids.includes(r.shelf))
      /**
       * Group by sleeve size before filing order. Nobody interleaves 7" singles
       * among their 12" compilations — the small ones live together, or they fall
       * over and get lost behind the big ones.
       */
      items.sort((a, b) => (b.height ?? 1) - (a.height ?? 1) || byFiling(a, b))
      label = ids.map((id) => shelfNames.get(id) || id).join(' + ') || 'empty'
    }

    for (const r of items) placed.add(r.instanceId)
    const width = items.reduce((a, r) => a + (r.width ?? 1), 0)

    return {
      index,
      row,
      col,
      type: slot.type,
      shelfIds: slot.shelfIds || [],
      label,
      sublabel,
      count: items.length,
      width: Math.round(width * 10) / 10,
      over: width > map.capacity,
      instanceIds: items.map((r) => r.instanceId),
    }
  })

  return {
    cols: map.cols,
    rows: map.rows,
    capacity: map.capacity,
    flowShelf: map.flowShelf,
    slots: built,
    unplaced: records.filter((r) => !placed.has(r.instanceId)).map((r) => r.instanceId),
    total: records.length,
  }
}

/** Which cube a single record stands in — powers "lives in cube 5" on the detail panel. */
export function locate(built, instanceId) {
  for (const slot of built.slots) {
    if (slot.instanceIds.includes(instanceId)) return slot
  }
  return null
}
