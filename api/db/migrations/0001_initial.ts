import { sql, type Kysely } from 'kysely'

/**
 * The first schema. Two halves:
 *
 * - A cache shared by every user: releases, masters and artists, fetched once from
 *   Discogs (and MusicBrainz), whoever owns them. `summary` is a release's row in a
 *   collection index, before any one user's filing fixes; `detail` is its pressing
 *   page. Both follow contract/models.ts.
 * - Per-user tables: who they are on Discogs, what they own and want, their unit and
 *   shelves, and what they've done on the phone.
 *
 * A Discogs account can exist before anyone has signed in with it ('pending': seeded
 * from a snapshot, or set up by the admin for a friend). The first sign-in by that
 * username claims it and fills in the id and tokens.
 *
 * Owned and wanted rows are never deleted while in use, only marked removed, and every
 * change takes the next number from collection_seq: the phone's cursor is the last
 * number it has seen, so "what changed since" is one indexed range scan.
 */
const UP = [
  sql`create extension if not exists pgcrypto`,

  sql`create table users (
    id uuid primary key default gen_random_uuid(),
    created_at timestamptz not null default now(),
    last_seen_at timestamptz
  )`,

  sql`create table discogs_accounts (
    user_id uuid primary key references users (id) on delete cascade,
    discogs_user_id integer unique,
    username text not null unique,
    avatar text,
    token_enc bytea,
    secret_enc bytea,
    status text not null default 'pending' check (status in ('pending', 'ok', 'expired', 'revoked')),
    connected_at timestamptz not null default now()
  )`,

  sql`create table artists (
    discogs_id integer primary key,
    name text not null,
    mbid uuid unique,
    spotify_id text unique,
    page jsonb,
    fetched_at timestamptz not null default now()
  )`,

  sql`create table masters (
    discogs_id integer primary key,
    title text not null,
    year integer,
    main_release_id integer,
    data jsonb,
    fetched_at timestamptz not null default now()
  )`,

  sql`create table releases (
    discogs_id integer primary key,
    master_id integer,
    title text not null,
    year integer,
    data jsonb,
    summary jsonb,
    detail jsonb,
    fetched_at timestamptz not null default now(),
    built_at timestamptz
  )`,
  sql`create index releases_master_id on releases (master_id) where master_id is not null`,

  sql`create table release_artists (
    release_id integer not null references releases (discogs_id) on delete cascade,
    artist_id integer not null,
    role text not null default '',
    position smallint not null default 0,
    primary key (release_id, artist_id, role)
  )`,
  sql`create index release_artists_artist on release_artists (artist_id)`,

  sql`create table media (
    id bigint generated always as identity primary key,
    release_id integer not null references releases (discogs_id) on delete cascade,
    kind text not null check (kind in ('cover', 'label', 'disc')),
    side text not null default '',
    storage_key text not null unique,
    width integer,
    height integer,
    sha256 text,
    created_at timestamptz not null default now(),
    unique (release_id, kind, side)
  )`,

  sql`create sequence collection_seq`,

  sql`create table owned (
    user_id uuid not null references users (id) on delete cascade,
    instance_id bigint not null,
    release_id integer not null references releases (discogs_id),
    folder_id integer not null default 0,
    added_at timestamptz not null,
    removed_at timestamptz,
    seq bigint not null default nextval('collection_seq'),
    primary key (user_id, instance_id)
  )`,
  sql`create index owned_changes on owned (user_id, seq)`,
  sql`create index owned_release on owned (release_id)`,

  sql`create table wanted (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references users (id) on delete cascade,
    kind text not null check (kind in ('release', 'master')),
    release_id integer,
    master_id integer,
    notes text,
    on_discogs boolean not null default false,
    added_at timestamptz not null default now(),
    removed_at timestamptz,
    seq bigint not null default nextval('collection_seq'),
    check ((kind = 'release' and release_id is not null and master_id is null)
        or (kind = 'master' and master_id is not null and release_id is null))
  )`,
  sql`create unique index wanted_release on wanted (user_id, release_id) where kind = 'release' and removed_at is null`,
  sql`create unique index wanted_master on wanted (user_id, master_id) where kind = 'master' and removed_at is null`,
  sql`create index wanted_changes on wanted (user_id, seq)`,

  sql`create table user_settings (
    user_id uuid primary key references users (id) on delete cascade,
    shelves jsonb not null,
    shelf_map jsonb not null,
    updated_at timestamptz not null default now()
  )`,

  sql`create table user_state (
    user_id uuid primary key references users (id) on delete cascade,
    version bigint not null default 0,
    state jsonb not null,
    updated_at timestamptz not null default now()
  )`,

  sql`create table applied_ops (
    user_id uuid not null references users (id) on delete cascade,
    op_id text not null,
    applied_at timestamptz not null default now(),
    primary key (user_id, op_id)
  )`,
  sql`create index applied_ops_age on applied_ops (applied_at)`,
]

const DOWN = [
  'applied_ops',
  'user_state',
  'user_settings',
  'wanted',
  'owned',
  'media',
  'release_artists',
  'releases',
  'masters',
  'artists',
  'discogs_accounts',
  'users',
]

export async function up(db: Kysely<any>) {
  for (const statement of UP) await statement.execute(db)
}

export async function down(db: Kysely<any>) {
  for (const table of DOWN) await sql`drop table if exists ${sql.table(table)}`.execute(db)
  await sql`drop sequence if exists collection_seq`.execute(db)
}
