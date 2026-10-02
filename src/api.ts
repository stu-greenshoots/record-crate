import type {
  AppState,
  ArtistGuess,
  CubeRef,
  MarketInfo,
  RecordSummary,
  ReleaseDetail,
  ShelfMap,
  LookupResult,
  PlaceResponse,
  BackCoverRead,
} from './types'

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  // JSON is the default, but a caller sending an image sets its own content type.
  const headers = init?.headers ?? (init?.body ? { 'Content-Type': 'application/json' } : undefined)
  const res = await fetch(`/api${path}`, { ...init, headers })
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(body.error || `Request failed (${res.status})`)
  }
  return res.json()
}

const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined })

const patch = <T>(path: string, body: unknown) =>
  req<T>(path, { method: 'PATCH', body: JSON.stringify(body) })

export const api = {
  state: () => req<AppState>('/state'),
  records: (sort?: string) =>
    req<{ records: RecordSummary[]; counts: Record<string, number>; sortMode: string }>(
      `/records${sort ? `?sort=${encodeURIComponent(sort)}` : ''}`,
    ),
  record: (instanceId: number) =>
    req<{
      record: RecordSummary
      detail: ReleaseDetail | null
      market: MarketInfo | null
      cube: CubeRef | null
    }>(`/records/${instanceId}`),
  shelfMap: () => req<ShelfMap>('/shelf-map'),
  setShelfMap: (body: Record<string, unknown>) => patch<ShelfMap>('/shelf-map', body),
  resetShelfMap: () => post<ShelfMap>('/shelf-map/reset'),
  refreshMarket: (instanceId: number) =>
    post<{ market: MarketInfo }>(`/records/${instanceId}/market?force=1`),
  sync: () => post<{ ok: true; count: number; added: number }>('/sync'),
  logout: () => post('/auth/logout'),
  setShelf: (instanceId: number, shelf: string) => patch(`/records/${instanceId}`, { shelf }),
  setOrder: (shelfId: string, instanceIds: number[]) =>
    post(`/shelves/${shelfId}/order`, { instanceIds }),
  freezeOrder: (shelfId: string, sort: string) => post(`/shelves/${shelfId}/freeze`, { sort }),
  addShelf: (name: string) => post<{ shelf: { id: string; name: string } }>('/shelves', { name }),
  renameShelf: (id: string, name: string) => patch(`/shelves/${id}`, { name }),
  deleteShelf: (id: string, moveTo: string) =>
    req(`/shelves/${id}?moveTo=${encodeURIComponent(moveTo)}`, { method: 'DELETE' }),
  reorderShelves: (ids: string[]) => post('/shelves/reorder', { ids }),
  reclassify: () => post<{ changed: number }>('/shelves/reclassify'),
  settings: (patchBody: Record<string, unknown>) => patch('/settings', patchBody),
  guesses: () => req<{ artists: ArtistGuess[] }>('/artists/guesses'),
  setSortName: (artistKey: string, sortName: string | null) =>
    post('/artists/sort-name', { artistKey, sortName }),
  /**
   * Read the back of a sleeve. The photo goes up as raw bytes rather than base64
   * in JSON — a 12MP capture is the whole point of this route, and encoding it
   * would inflate it by a third for no gain.
   */
  readBackCover: (photo: Blob) =>
    req<BackCoverRead>('/identify/back', {
      method: 'POST',
      body: photo,
      headers: { 'Content-Type': photo.type || 'image/jpeg' },
    }),
  lookup: (params: { barcode?: string; q?: string; catno?: string }) =>
    req<{ results: LookupResult[]; via: string }>(
      `/lookup?${new URLSearchParams(params as Record<string, string>)}`,
    ),
  place: (body: { instanceId?: number; releaseId?: number }) => post<PlaceResponse>('/place', body),
  startValuation: () => post('/value/start'),
  value: () =>
    req<{ total: number; priced: number; currency: string; progress: { done: number; total: number; running: boolean } }>(
      '/value',
    ),
}

/** Route Discogs art through the local cache so repeat views are instant. */
export function img(url: string | null | undefined, fallback = ''): string {
  if (!url) return fallback
  if (!/^https:\/\/(i\.|img\.)?discogs\.com|^https:\/\/[a-z0-9-]+\.discogs\.com/i.test(url)) return url
  return `/api/img?u=${encodeURIComponent(url)}`
}
