export type SortBasis = 'override' | 'discogs' | 'guess' | 'plain'

export interface Shelf {
  id: string
  name: string
  hint?: string
}

export interface RecordSummary {
  instanceId: number
  releaseId: number
  masterId: number | null
  title: string
  artist: string
  artistName: string
  artistId: number | null
  artistKey: string
  sortName: string
  sortBasis: SortBasis
  artistType: string
  year: number | null
  /** When the album first came out, from the Discogs master release. */
  originalYear: number | null
  isReissue: boolean
  addedAt: string
  rating: number
  genres: string[]
  styles: string[]
  labels: { name: string; catno: string; id: number }[]
  catno: string
  label: string
  formatLine: string
  formatShort: string
  formatTags: string[]
  /** Shelf space this copy takes, in standard-LP widths. */
  width: number
  /** Sleeve height relative to a 12" LP. */
  height: number
  isBox: boolean
  shelf: string
  autoShelf: string | null
  position: number | null
  thumb: string
  cover: string
  back: string | null
  imageCount: number
  hasDetail: boolean
  lowestPrice: number | null
  currency: string | null
  numForSale: number | null
}

export interface ReleaseDetail {
  id: number
  title: string
  year: number | null
  released: string | null
  country: string | null
  notes: string | null
  uri: string | null
  genres: string[]
  styles: string[]
  artists: { id: number; name: string; anv: string | null; join: string }[]
  labels: { id: number; name: string; catno: string }[]
  formats: { name: string; qty: string; text: string | null; descriptions: string[] }[]
  images: { type: string; uri: string; thumb: string; width: number; height: number }[]
  tracklist: {
    position: string
    title: string
    duration: string
    type: string
    artists: string[]
    credits: { name: string; role: string }[]
  }[]
  credits: { id: number; name: string; role: string }[]
  companies: { name: string; role: string }[]
  identifiers: { type: string; value: string; description: string | null }[]
  videos: { uri: string; title: string; duration: number }[]
  community: { have: number; want: number; rating: { average: number; count: number } | null } | null
  numForSale: number | null
  lowestPrice: number | null
  missing?: boolean
}

export interface MarketInfo {
  fetchedAt: number
  stats: {
    lowest_price: { value: number; currency: string } | null
    num_for_sale: number
    blocked_from_sale?: boolean
  } | null
  suggestions: Record<string, { value: number; currency: string }> | null
}

export interface AppState {
  authed: boolean
  user: { username: string; name: string; avatar: string; profileUrl: string } | null
  collection: { count: number; syncedAt: string | null }
  sync: {
    running: boolean
    page: number
    pages: number
    fetched: number
    total: number
    error: string | null
  }
  enrich: {
    running: boolean
    releases: { done: number; total: number }
    artists: { done: number; total: number }
    masters: { done: number; total: number }
    market: { done: number; total: number; running: boolean }
    error: string | null
  }
  api: { remaining: number | null; queued: number }
  shelves: Shelf[]
  settings: { sortMode: string; view: string }
  sortModes: { id: string; label: string }[]
  currency: string
}

export interface ShelfSlot {
  index: number
  row: number
  col: number
  type: string
  shelfIds: string[]
  label: string
  sublabel: string
  count: number
  width: number
  over: boolean
  instanceIds: number[]
}

export interface ShelfMap {
  cols: number
  rows: number
  capacity: number
  flowShelf: string
  slots: ShelfSlot[]
  unplaced: number[]
  total: number
}

export interface CubeRef {
  index: number
  row: number
  col: number
  label: string
  count: number
}

export interface ArtistGuess {
  artistKey: string
  artist: string
  sortName: string
  basis: SortBasis
  type: string
  count: number
}

export interface LookupResult {
  releaseId: number
  title: string
  year: number | null
  thumb: string | null
  cover: string | null
  format: string
  label: string | null
  catno: string | null
  country: string | null
  /** How well this release's catalogue number matches what was read off the sleeve. */
  match?: number
}

/** What reading the back of a sleeve produced, before any of it is resolved. */
export interface BackCoverRead {
  read: {
    catalogueNumbers: { value: string; confidence: number; score: number }[]
    phrases: string[]
    searchTerms: string | null
    pixelsAcross: number
    resolutionOk: boolean
  }
  owned: { catno: string; instanceId: number; read: string; match: number }[]
  results: LookupResult[]
  via: 'catno' | 'text' | null
}

export interface PlacementNeighbour {
  instanceId: number
  title: string
  artist: string
  sortName: string
  year: number | null
  cover: string
  cubeIndex: number
  cubeLabel: string
}

export interface Placement {
  shelf: string
  shelfName: string
  cube: { index: number; row: number; col: number; label: string; count: number; type: string }
  position: number
  before: PlacementNeighbour | null
  after: PlacementNeighbour | null
  letter: string
  atCubeStart: boolean
  atCubeEnd: boolean
}

export interface PlaceResponse {
  record: {
    title: string
    artist: string
    sortName: string
    originalYear: number | null
    shelf: string
    cover?: string | null
    width?: number
    height?: number
    formatShort?: string
  }
  alreadyOwned?: number | null
  placement: Placement | null
}
