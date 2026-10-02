export interface Rec {
  id: number
  releaseId: number
  title: string
  artist: string
  credit: string
  sortName: string
  year: number | null
  originalYear: number | null
  shelf: string
  width: number
  height: number
  format: string
  catno: string
  label: string
  genres: string[]
  styles: string[]
  addedAt: string
  cover: string | null
  remoteCover: string | null
  colour?: string | null
  /** Pulled in from Discogs after the snapshot was taken. */
  fresh?: boolean
}

export interface Shelf {
  id: string
  name: string
  hint?: string
}

export interface SlotConfig {
  type: 'flow' | 'shelves'
  shelfIds?: string[]
}

export interface ShelfMapConfig {
  cols: number
  rows: number
  capacity: number
  flowShelf: string
  slots: SlotConfig[]
}

export interface Snapshot {
  exportedAt: string
  syncedAt: string
  username: string
  shelves: Shelf[]
  shelfMap: ShelfMapConfig
  records: Rec[]
}

export interface Cube {
  index: number
  row: number
  col: number
  type: 'flow' | 'shelves'
  label: string
  sublabel: string
  count: number
  width: number
  over: boolean
  instanceIds: number[]
}

export interface BuiltMap {
  cols: number
  rows: number
  capacity: number
  slots: Cube[]
  unplaced: number[]
  total: number
}

/** Where one record stands. */
export interface Spot {
  cube: Cube
  /** 0-based position within the cube, left to right. */
  index: number
  before: Rec | null
  after: Rec | null
}
