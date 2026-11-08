import type { ColumnType, Generated, Insertable, Selectable } from 'kysely'
import type { RecordSummary, ReleaseDetail, Shelf, ShelfMapConfig, UserState, ArtistPage } from '../../contract'

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>
type Defaulted<T> = ColumnType<T, T | undefined, T>
type Json<T> = ColumnType<T, string, string>
type NullableJson<T> = ColumnType<T | null, string | null | undefined, string | null>

export interface UsersTable {
  id: Generated<string>
  created_at: Timestamp
  last_seen_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
}

export interface DiscogsAccountsTable {
  user_id: string
  discogs_user_id: number | null
  username: string
  avatar: string | null
  token_enc: Buffer | null
  secret_enc: Buffer | null
  status: Defaulted<'pending' | 'ok' | 'expired' | 'revoked'>
  connected_at: Timestamp
}

export interface ArtistsTable {
  discogs_id: number
  name: string
  mbid: string | null
  spotify_id: string | null
  page: NullableJson<ArtistPage>
  fetched_at: Timestamp
}

export interface MastersTable {
  discogs_id: number
  title: string
  year: number | null
  main_release_id: number | null
  data: NullableJson<unknown>
  fetched_at: Timestamp
}

/**
 * A release's index row, less what belongs to one user's copy. In the index, people
 * point into a list built per collection; here each carries its own name and roles,
 * with the kinds of credit it has on this release.
 */
export type ReleaseSummary = Omit<RecordSummary, 'id' | 'addedAt' | 'people'> & {
  people?: [name: string, roles: string, kinds: number][]
}

export interface ReleasesTable {
  discogs_id: number
  master_id: number | null
  title: string
  year: number | null
  data: NullableJson<unknown>
  summary: NullableJson<ReleaseSummary>
  detail: NullableJson<ReleaseDetail>
  fetched_at: Timestamp
  built_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
}

export interface ReleaseArtistsTable {
  release_id: number
  artist_id: number
  role: Defaulted<string>
  position: Defaulted<number>
}

export interface MediaTable {
  id: Generated<string>
  release_id: number
  kind: 'cover' | 'label' | 'disc'
  side: Defaulted<string>
  storage_key: string
  width: number | null
  height: number | null
  sha256: string | null
  created_at: Timestamp
}

export interface OwnedTable {
  user_id: string
  instance_id: string | number
  release_id: number
  folder_id: Defaulted<number>
  added_at: ColumnType<Date, Date | string, Date | string>
  removed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
  seq: Generated<string>
}

export interface WantedTable {
  id: Generated<string>
  user_id: string
  kind: 'release' | 'master'
  release_id: number | null
  master_id: number | null
  notes: string | null
  on_discogs: Defaulted<boolean>
  added_at: Timestamp
  removed_at: ColumnType<Date | null, Date | string | null | undefined, Date | string | null>
  seq: Generated<string>
}

export interface UserSettingsTable {
  user_id: string
  shelves: Json<Shelf[]>
  shelf_map: Json<ShelfMapConfig>
  updated_at: Timestamp
}

export interface UserStateTable {
  user_id: string
  version: ColumnType<string, number | string | undefined, number | string>
  state: Json<UserState>
  updated_at: Timestamp
}

export interface AppliedOpsTable {
  user_id: string
  op_id: string
  applied_at: Timestamp
}

export interface Database {
  users: UsersTable
  discogs_accounts: DiscogsAccountsTable
  artists: ArtistsTable
  masters: MastersTable
  releases: ReleasesTable
  release_artists: ReleaseArtistsTable
  media: MediaTable
  owned: OwnedTable
  wanted: WantedTable
  user_settings: UserSettingsTable
  user_state: UserStateTable
  applied_ops: AppliedOpsTable
}

export type Release = Selectable<ReleasesTable>
export type NewRelease = Insertable<ReleasesTable>
