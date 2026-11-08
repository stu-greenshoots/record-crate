import { z } from 'zod'
import {
  ArtistPage,
  CollectionChanges,
  CollectionIndex,
  ErrorCode,
  Job,
  JobKind,
  Me,
  NewWant,
  ReleaseDetail,
  StateOp,
  StateSnapshot,
  Want,
} from './models'

export type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE'

/** Who may call a route: anyone, a signed-in user, or the admin (a separate login). */
export type Access = 'public' | 'user' | 'admin'

export interface Route {
  method: Method
  /** Express-style, e.g. /api/releases/:releaseId */
  path: string
  access: Access
  params?: z.ZodTypeAny
  query?: z.ZodTypeAny
  body?: z.ZodTypeAny
  /** null: no JSON body (a redirect, or 204). */
  response: z.ZodTypeAny | null
  /** Errors the caller is expected to handle, beyond unauthenticated/invalid/internal. */
  errors?: readonly ErrorCode[]
}

const idParam = (name: string) => z.object({ [name]: z.coerce.number().int().positive() })

export const AdminOverview = z.object({
  users: z.array(
    z.object({
      userId: z.string(),
      username: z.string(),
      collectionSize: z.number().int(),
      lastSeenAt: z.string().nullable(),
      discogs: z.enum(['pending', 'ok', 'expired', 'revoked']),
      spotify: z.enum(['ok', 'expired', 'none']),
      /** Discogs requests left in this user's current minute. */
      discogsBudget: z.number().int(),
    }),
  ),
  queues: z.array(
    z.object({
      kind: JobKind,
      waiting: z.number().int(),
      active: z.number().int(),
      failed: z.number().int(),
      /** Jobs that gave up after their retries and wait for a look. */
      dead: z.number().int(),
    }),
  ),
})

export const routes = {
  /* Sign-in: the server runs Discogs OAuth and sets a session cookie. */
  discogsStart: {
    method: 'GET',
    path: '/api/auth/discogs/start',
    access: 'public',
    query: z.object({ next: z.string().startsWith('/').optional() }),
    response: null,
  },
  discogsCallback: {
    method: 'GET',
    path: '/api/auth/discogs/callback',
    access: 'public',
    query: z.object({ oauth_token: z.string(), oauth_verifier: z.string() }),
    response: null,
  },
  logout: { method: 'POST', path: '/api/auth/logout', access: 'user', response: null },
  me: { method: 'GET', path: '/api/me', access: 'user', response: Me },

  /* The collection: the whole index once, then only what changed. */
  collection: {
    method: 'GET',
    path: '/api/collection',
    access: 'user',
    response: CollectionIndex,
  },
  collectionChanges: {
    method: 'GET',
    path: '/api/collection/changes',
    access: 'user',
    query: z.object({ since: z.string() }),
    response: CollectionChanges,
    errors: ['resync'],
  },
  release: {
    method: 'GET',
    path: '/api/releases/:releaseId',
    access: 'user',
    params: idParam('releaseId'),
    response: ReleaseDetail,
    errors: ['not-found'],
  },
  artist: {
    method: 'GET',
    path: '/api/artists/:artistId',
    access: 'user',
    params: idParam('artistId'),
    response: ArtistPage,
    errors: ['not-found'],
  },

  /* What you've done on the phone. */
  state: { method: 'GET', path: '/api/state', access: 'user', response: StateSnapshot },
  applyState: {
    method: 'PATCH',
    path: '/api/state',
    access: 'user',
    body: z.object({ ops: z.array(StateOp).min(1).max(500) }),
    response: StateSnapshot,
  },

  /* Want list. */
  wants: { method: 'GET', path: '/api/wants', access: 'user', response: z.array(Want) },
  addWant: {
    method: 'POST',
    path: '/api/wants',
    access: 'user',
    body: NewWant,
    response: Want,
    errors: ['conflict', 'upstream'],
  },
  removeWant: {
    method: 'DELETE',
    path: '/api/wants/:wantId',
    access: 'user',
    params: z.object({ wantId: z.string() }),
    response: null,
    errors: ['not-found', 'upstream'],
  },

  /* Background work. */
  startSync: { method: 'POST', path: '/api/sync', access: 'user', response: Job, errors: ['rate-limited'] },
  jobs: {
    method: 'GET',
    path: '/api/jobs',
    access: 'user',
    query: z.object({ kind: JobKind.optional() }),
    response: z.array(Job),
  },

  /* Admin: a separate login, not a Discogs account. */
  adminOverview: { method: 'GET', path: '/api/admin/overview', access: 'admin', response: AdminOverview },

  health: {
    method: 'GET',
    path: '/api/health',
    access: 'public',
    response: z.object({ ok: z.boolean(), db: z.boolean(), queue: z.boolean() }),
  },
} as const satisfies Record<string, Route>

export type Routes = typeof routes
export type RouteName = keyof Routes

type Infer<T> = T extends z.ZodTypeAny ? z.infer<T> : undefined
type Field<R, K extends string> = R extends Record<K, infer S> ? Infer<S> : undefined

export type RequestOf<N extends RouteName> = {
  params: Field<Routes[N], 'params'>
  query: Field<Routes[N], 'query'>
  body: Field<Routes[N], 'body'>
}

export type ResponseOf<N extends RouteName> = Infer<Routes[N]['response']>

/** Fill a route's :params into its path. */
export function pathFor(path: string, params: Record<string, string | number> = {}) {
  return path.replace(/:(\w+)/g, (_, key: string) => {
    if (!(key in params)) throw new Error(`Missing path parameter ${key} for ${path}`)
    return encodeURIComponent(String(params[key]))
  })
}
