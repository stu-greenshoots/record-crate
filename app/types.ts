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
  /** The centre label, cropped to its circle, where a photo of it was found. */
  labelArt?: string | null
  /** Its sides in playing order, each with its label photo where one was found. */
  faces?: Face[]
  /** The record's size where it isn't a 12", e.g. 7 for a single. */
  inches?: number
  /** The label photo is really the whole record (a coloured or picture disc, say). */
  labelDisc?: boolean
  /** Who plays on, engineers or produces it: [index into Snapshot.people, kinds]. */
  people?: [number, number][]
  masterId?: number | null
  artistId?: number | null
  /** Where this pressing was made, and what the versions say about it. */
  country?: string | null
  press?: PressKind | null
  have?: number | null
  want?: number | null
  /** Suggested price at VG+, in the snapshot's currency. */
  value?: number | null
  plant?: string | null
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
  /** First letter this cube holds, when the A–Z run is split by letter. */
  from?: string
}

export type SplitMode = 'even' | 'fill' | 'letters'

export interface ShelfMapConfig {
  cols: number
  rows: number
  capacity: number
  flowShelf: string
  split?: SplitMode
  slots: SlotConfig[]
}

export interface Snapshot {
  exportedAt: string
  syncedAt: string
  username: string
  shelves: Shelf[]
  shelfMap: ShelfMapConfig
  /** [name, roles], e.g. ["Steve Hillage", "guitar, producer"]. */
  people?: [string, string][]
  /** Discogs artist id -> [studio have, studio total, live have, live total]. */
  completeness?: Record<string, [number, number, number, number]>
  records: Rec[]
}

export interface Cube {
  index: number
  row: number
  col: number
  type: 'flow' | 'shelves'
  shelfIds: string[]
  label: string
  sublabel: string
  /** First letter, for a lettered A–Z cube. */
  from: string | null
  count: number
  width: number
  over: boolean
  instanceIds: number[]
}

export interface BuiltMap {
  cols: number
  rows: number
  capacity: number
  split: SplitMode
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

export type PressKind = 'first' | 'same-year' | 'first-local' | 'first-vinyl' | 'reissue' | 'repress' | 'unofficial' | 'unknown'

/** public/pressings/<releaseId>.json: everything known about one pressing. */
export interface Pressing {
  verdict: {
    kind: PressKind
    text: string
    detail?: string | null
    firstYear: number | null
    origin: string | null
    promo: boolean
    versions: number
  } | null
  versionCount: number | null
  released: string | null
  country: string | null
  labels: { name: string; catno: string }[]
  physical: string[]
  cutters: string[]
  runouts: { variant: number | null; sides: { value: string; side: string }[] }[]
  notes: { text: string; href?: string }[]
  have: number | null
  want: number | null
  rating: { count: number; average: number } | null
  value: {
    currency: string | null
    mint: number | null
    nearMint: number | null
    vgPlus: number | null
    vg: number | null
    lowest: number | null
    forSale: number | null
  }
  uri: string
}

export interface Face {
  side: string
  art?: string
  /** The photo is of the whole record, not just its label. */
  disc?: boolean
  /** The other side's whole-record photo, shown round this side's label. */
  under?: string
}
