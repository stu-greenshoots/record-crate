import { z } from 'zod'

const id = z.number().int().positive()
const isoDate = z.string().datetime({ offset: true })

/* ------------------------------------------------------------------ */
/* Shelves and the unit                                                */
/* ------------------------------------------------------------------ */

export const Shelf = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  hint: z.string().optional(),
})

export const SlotConfig = z.object({
  type: z.enum(['flow', 'shelves']),
  shelfIds: z.array(z.string()).optional(),
  from: z.string().optional(),
})

export const ShelfMapConfig = z.object({
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
  capacity: z.number().positive(),
  flowShelf: z.string(),
  split: z.enum(['even', 'fill', 'letters']).optional(),
  slots: z.array(SlotConfig),
})

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

export const PressKind = z.enum([
  'first',
  'same-year',
  'first-local',
  'first-vinyl',
  'reissue',
  'repress',
  'unofficial',
  'unknown',
])

export const Face = z.object({
  side: z.string(),
  art: z.string().optional(),
  disc: z.boolean().optional(),
  under: z.string().optional(),
})

/**
 * One row of the collection index: everything placement, search, filters and the
 * shelf views need, for every record the user owns. `id` is the Discogs collection
 * instance; the release behind it is shared between users.
 */
export const RecordSummary = z.object({
  id,
  releaseId: id,
  title: z.string(),
  artist: z.string(),
  credit: z.string(),
  sortName: z.string(),
  year: z.number().int().nullable(),
  originalYear: z.number().int().nullable(),
  shelf: z.string(),
  width: z.number().nonnegative(),
  height: z.number().nonnegative(),
  format: z.string(),
  catno: z.string(),
  label: z.string(),
  genres: z.array(z.string()),
  styles: z.array(z.string()),
  addedAt: z.string(),
  cover: z.string().nullable(),
  remoteCover: z.string().nullable(),
  colour: z.string().nullable().optional(),
  labelArt: z.string().nullable().optional(),
  faces: z.array(Face).optional(),
  inches: z.number().optional(),
  labelDisc: z.boolean().optional(),
  people: z.array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()])).optional(),
  masterId: id.nullable().optional(),
  artistId: id.nullable().optional(),
  country: z.string().nullable().optional(),
  press: PressKind.nullable().optional(),
  have: z.number().int().nullable().optional(),
  want: z.number().int().nullable().optional(),
  value: z.number().nullable().optional(),
  plant: z.string().nullable().optional(),
})

/** The whole collection, as the phone loads it. Placement needs every record. */
export const CollectionIndex = z.object({
  /** Opaque; pass it to the changes endpoint to fetch only what's new. */
  cursor: z.string(),
  syncedAt: isoDate.nullable(),
  username: z.string(),
  /** The user's default shelves and unit, before anything they've changed on the phone. */
  shelves: z.array(Shelf),
  shelfMap: ShelfMapConfig,
  /** [name, roles]; RecordSummary.people points into this. */
  people: z.array(z.tuple([z.string(), z.string()])),
  /** Discogs artist id -> [studio have, studio total, live have, live total]. */
  completeness: z.record(z.tuple([z.number(), z.number(), z.number(), z.number()])),
  records: z.array(RecordSummary),
})

export const CollectionChanges = z.object({
  cursor: z.string(),
  upserts: z.array(RecordSummary),
  removed: z.array(id),
  /** New people entries; indices continue from the ones the phone already has. */
  people: z.array(z.tuple([z.string(), z.string()])),
})

export const Track = z.object({
  position: z.string(),
  title: z.string(),
  seconds: z.number().nullable(),
})

export const Side = z.object({ side: z.string(), tracks: z.array(Track) })

/** Everything known about one pressing. Shared between users, so it caches well. */
export const ReleaseDetail = z.object({
  sides: z.array(Side).optional(),
  verdict: z
    .object({
      kind: PressKind,
      text: z.string(),
      detail: z.string().nullable().optional(),
      firstYear: z.number().int().nullable(),
      origin: z.string().nullable(),
      promo: z.boolean(),
      versions: z.number().int(),
    })
    .nullable(),
  versionCount: z.number().int().nullable(),
  released: z.string().nullable(),
  country: z.string().nullable(),
  labels: z.array(z.object({ name: z.string(), catno: z.string() })),
  physical: z.array(z.string()),
  cutters: z.array(z.string()),
  runouts: z.array(
    z.object({
      variant: z.number().int().nullable(),
      sides: z.array(z.object({ value: z.string(), side: z.string() })),
    }),
  ),
  notes: z.array(z.object({ text: z.string(), href: z.string().optional() })),
  have: z.number().int().nullable(),
  want: z.number().int().nullable(),
  rating: z.object({ count: z.number().int(), average: z.number() }).nullable(),
  value: z.object({
    currency: z.string().nullable(),
    mint: z.number().nullable(),
    nearMint: z.number().nullable(),
    vgPlus: z.number().nullable(),
    vg: z.number().nullable(),
    lowest: z.number().nullable(),
    forSale: z.number().nullable(),
  }),
  uri: z.string(),
})

const Person = z.object({
  mbid: z.string(),
  name: z.string(),
  discogsId: id.nullable(),
  begin: z.string().nullable(),
  end: z.string().nullable(),
})

export const ArtistPage = z.object({
  discogsId: id.nullable(),
  mbid: z.string().nullable(),
  name: z.string(),
  type: z.string().nullable(),
  members: z.array(Person.extend({ ended: z.boolean(), roles: z.array(z.string()) })),
  bands: z.array(Person),
  groups: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      date: z.string().nullable(),
      primary: z.string().nullable(),
      secondary: z.array(z.string()),
      masters: z.array(id),
    }),
  ),
})

/* ------------------------------------------------------------------ */
/* What the user has done: their state, changed by operations          */
/* ------------------------------------------------------------------ */

export const UserState = z.object({
  /** Record id -> when it came off the shelf (ms since epoch). */
  out: z.record(z.number()),
  recent: z.array(id),
  shelfOf: z.record(z.string()),
  sortOf: z.record(z.string()),
  shelves: z.array(Shelf).nullable(),
  map: ShelfMapConfig.nullable(),
  sorted: z.record(z.array(id)),
  runoutOf: z.record(z.number().int()),
})

const op = <T extends z.ZodRawShape>(name: string, shape: T) =>
  z.object({ op: z.literal(name), opId: z.string().min(8), at: isoDate, ...shape })

/**
 * The phone records what you do as operations and sends them in order. Each carries
 * an id, so a batch resent after a dropped connection is applied once. Every
 * operation sets a value rather than toggling one, so replaying it is harmless.
 */
export const StateOp = z.discriminatedUnion('op', [
  op('takeOut', { id }),
  op('putBack', { id }),
  op('noteLookup', { id }),
  op('setSortName', { ids: z.array(id).min(1), sortName: z.string() }),
  op('moveToShelf', { ids: z.array(id).min(1), shelf: z.string() }),
  op('saveShelves', { shelves: z.array(Shelf) }),
  op('deleteShelf', { shelf: z.string() }),
  op('setMap', { map: ShelfMapConfig.nullable() }),
  op('setSorted', { cube: z.number().int().nonnegative(), id, sorted: z.boolean() }),
  op('resetSorted', { cube: z.number().int().nonnegative() }),
  op('setRunout', { id, variant: z.number().int().nullable() }),
])

export const StateSnapshot = z.object({
  /** Increases with every applied operation. */
  version: z.number().int().nonnegative(),
  state: UserState,
})

/* ------------------------------------------------------------------ */
/* Accounts, wants, jobs                                               */
/* ------------------------------------------------------------------ */

export const Me = z.object({
  userId: z.string(),
  username: z.string(),
  avatar: z.string().nullable(),
  /** Which outside services this user has connected. */
  connections: z.object({
    discogs: z.enum(['ok', 'expired', 'revoked']),
    spotify: z.enum(['ok', 'expired', 'none']),
  }),
  collectionSize: z.number().int().nonnegative(),
})

/** A want is either one pressing (Discogs' own want list) or any copy of an album. */
export const Want = z.object({
  id: z.string(),
  target: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('release'), releaseId: id }),
    z.object({ kind: z.literal('master'), masterId: id }),
  ]),
  title: z.string(),
  artist: z.string(),
  cover: z.string().nullable(),
  addedAt: isoDate,
  notes: z.string().nullable(),
  /** Kept in step with the Discogs want list (release wants only). */
  onDiscogs: z.boolean(),
})

export const NewWant = z.object({
  target: Want.shape.target,
  notes: z.string().max(500).optional(),
})

export const JobKind = z.enum(['sync', 'enrich', 'media', 'file-one'])

export const Job = z.object({
  id: z.string(),
  kind: JobKind,
  state: z.enum(['queued', 'running', 'done', 'failed']),
  /** 0–1 when the job can tell. */
  progress: z.number().min(0).max(1).nullable(),
  message: z.string().nullable(),
  startedAt: isoDate.nullable(),
  finishedAt: isoDate.nullable(),
})

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

export const ErrorCode = z.enum([
  'unauthenticated',
  'forbidden',
  'not-found',
  'invalid',
  'conflict',
  /** The changes cursor is too old: load the whole collection again. */
  'resync',
  'rate-limited',
  'upstream',
  'internal',
])

export const ApiError = z.object({
  error: z.object({
    code: ErrorCode,
    message: z.string(),
    /** Seconds, for rate-limited. */
    retryAfter: z.number().optional(),
    issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
  }),
})

export type Shelf = z.infer<typeof Shelf>
export type SlotConfig = z.infer<typeof SlotConfig>
export type ShelfMapConfig = z.infer<typeof ShelfMapConfig>
export type PressKind = z.infer<typeof PressKind>
export type Face = z.infer<typeof Face>
export type RecordSummary = z.infer<typeof RecordSummary>
export type CollectionIndex = z.infer<typeof CollectionIndex>
export type CollectionChanges = z.infer<typeof CollectionChanges>
export type Track = z.infer<typeof Track>
export type Side = z.infer<typeof Side>
export type ReleaseDetail = z.infer<typeof ReleaseDetail>
export type ArtistPage = z.infer<typeof ArtistPage>
export type UserState = z.infer<typeof UserState>
export type StateOp = z.infer<typeof StateOp>
export type StateSnapshot = z.infer<typeof StateSnapshot>
export type Me = z.infer<typeof Me>
export type Want = z.infer<typeof Want>
export type NewWant = z.infer<typeof NewWant>
export type JobKind = z.infer<typeof JobKind>
export type Job = z.infer<typeof Job>
export type ErrorCode = z.infer<typeof ErrorCode>
export type ApiError = z.infer<typeof ApiError>
