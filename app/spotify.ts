import { useSyncExternalStore } from 'react'
import { bestAlbum } from '../shared/spotify.js'
import { sides as sidesFrom } from '../shared/sides.js'
import { withLengths } from '../shared/needle.js'
import { loadPressing } from './components/Pressing'
import type { Rec, Side } from './types'

/**
 * Playing the record: Spotify's Web Playback SDK makes this app a Spotify player (it
 * needs Premium), and the Web API tells it what to play and from where. Sign-in is
 * PKCE, so there's no secret and no server. Tested on the phone first (spike/play.html).
 */
const CLIENT_ID = 'f623fdf1f6f74f9fb142f097a4e61af1'
// Spotify only returns to the address registered for the app: the front page.
const REDIRECT = new URL(import.meta.env.BASE_URL, location.origin).href
const SCOPES = 'streaming user-read-email user-read-private user-read-playback-state user-modify-playback-state'
const KEY = 'record-crate:spotify'
const ALBUMS = 'record-crate:spotify-albums'

interface Token {
  access: string
  refresh: string
  until: number
}

/** What's playing: which record and side, and where Spotify last said it was. */
export interface NowPlaying {
  recId: number
  rec: Rec
  sides: Side[]
  /** Where the record lives in the app, for getting back to it from the player bar. */
  route: string
  face: number
  /** The side's track index (Discogs order), or -1 if Spotify moved on to something else. */
  track: number
  position: number
  /** The track's length, once Spotify has said, in ms. */
  duration: number
  paused: boolean
  /** When position was true, for working out where the needle is now. */
  at: number
}

interface State {
  connected: boolean
  name: string | null
  ready: boolean
  now: NowPlaying | null
}

let state: State = { connected: Boolean(read<Token>(KEY)), name: null, ready: false, now: null }
const listeners = new Set<() => void>()
function set(next: Partial<State>) {
  state = { ...state, ...next }
  listeners.forEach((l) => l())
}
export function useSpotify() {
  return useSyncExternalStore(
    (l) => (listeners.add(l), () => listeners.delete(l)),
    () => state,
  )
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}
function write(key: string, value: unknown) {
  try {
    if (value == null) localStorage.removeItem(key)
    else localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode: sign-in lasts as long as the page.
  }
}

const b64url = (bytes: ArrayBuffer | Uint8Array) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')

export async function connect() {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)))
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)))
  const stateId = `rc-${b64url(crypto.getRandomValues(new Uint8Array(9)))}`
  write(`${KEY}:pending`, { verifier, state: stateId, hash: location.hash })
  location.href = `https://accounts.spotify.com/authorize?${new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state: stateId,
  })}`
}

export function disconnect() {
  player?.disconnect()
  player = null
  deviceId = null
  write(KEY, null)
  set({ connected: false, name: null, ready: false, now: null })
}

async function tokenCall(params: Record<string, string>) {
  const res = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, ...params }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Spotify sign-in: ${body.error_description || body.error || res.status}`)
  const t: Token = {
    access: body.access_token,
    refresh: body.refresh_token || read<Token>(KEY)?.refresh || '',
    until: Date.now() + (body.expires_in - 60) * 1000,
  }
  write(KEY, t)
  return t
}

async function token(): Promise<string> {
  const t = read<Token>(KEY)
  if (!t) throw new Error('Not connected to Spotify')
  if (Date.now() < t.until) return t.access
  try {
    return (await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh })).access
  } catch (err) {
    // A refused refresh means signing in again; a network failure doesn't.
    if (navigator.onLine) disconnect()
    throw err
  }
}

async function api(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.spotify.com/v1/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' },
  })
  if (res.status === 204) return null
  const text = await res.text()
  if (!res.ok) throw new Error(`Spotify ${res.status}: ${text.slice(0, 160)}`)
  return text ? JSON.parse(text) : null
}

/** Back from Spotify's sign-in: swap the code for a token, and put the page back as it was. */
async function finishSignIn() {
  const params = new URLSearchParams(location.search)
  const pending = read<{ verifier: string; state: string; hash: string }>(`${KEY}:pending`)
  if (!params.get('state')?.startsWith('rc-')) return
  write(`${KEY}:pending`, null)
  history.replaceState(null, '', `${location.pathname}${pending?.hash || ''}`)
  if (!pending || params.get('state') !== pending.state || !params.get('code')) return
  await tokenCall({ grant_type: 'authorization_code', code: params.get('code')!, redirect_uri: REDIRECT, code_verifier: pending.verifier })
  set({ connected: true })
}

// ---------------------------------------------------------------------------
// The player

declare global {
  interface Window {
    onSpotifyWebPlaybackSDKReady?: () => void
    Spotify?: any
  }
}

let player: any = null
let deviceId: string | null = null
// Which Spotify track is which side and track of the record, from the one dropped on
// to the end of the album: it plays on through the sides, as a record changer would.
let queue: { uri: string; face: number; track: number }[] = []

function startPlayer() {
  if (player || !read<Token>(KEY)) return
  window.onSpotifyWebPlaybackSDKReady = () => {
    player = new window.Spotify.Player({
      name: 'Record Crate',
      getOAuthToken: (cb: (t: string) => void) => token().then(cb).catch(() => {}),
      volume: 0.9,
    })
    player.addListener('ready', ({ device_id }: { device_id: string }) => {
      deviceId = device_id
      set({ ready: true })
    })
    player.addListener('not_ready', () => set({ ready: false }))
    player.addListener('authentication_error', () => disconnect())
    player.addListener('player_state_changed', (s: any) => {
      if (!s || !state.now) return
      const t = s.track_window?.current_track
      // Spotify may play a different copy of a track in your country, saying which it was.
      const at = queue.find((q) => q.uri === t?.linked_from?.uri) || queue.find((q) => q.uri === t?.uri)
      set({
        now: {
          ...state.now,
          face: at ? at.face : state.now.face,
          track: at ? at.track : -1,
          position: s.position,
          duration: s.duration || 0,
          paused: s.paused,
          at: Date.now(),
        },
      })
      showOnLockScreen()
    })
    player.connect()
  }
  const sdk = document.createElement('script')
  sdk.src = 'https://sdk.scdn.co/spotify-player.js'
  document.head.append(sdk)
  api('me')
    .then((me) => set({ name: me?.display_name || null }))
    .catch(() => {})
}

finishSignIn()
  .catch(() => {})
  .finally(startPlayer)

// ---------------------------------------------------------------------------
// Finding the record on Spotify

/** The record's sides and tracks: from the snapshot's pressing notes, or Discogs for a new one. */
export async function sidesOf(rec: Rec): Promise<Side[]> {
  if (rec.sides) return rec.sides
  const p = await loadPressing(rec.releaseId)
  if (p?.sides?.length) return p.sides
  const res = await fetch(`https://api.discogs.com/releases/${rec.releaseId}`).catch(() => null)
  if (!res?.ok) return []
  return sidesFrom((await res.json()).tracklist || []) as Side[]
}

interface Found {
  id: string
  /** One per Discogs track, all sides in order; null where Spotify's album lacks it. */
  uris: (string | null)[]
  /** Spotify's length of each, for the many records Discogs has no lengths for. */
  seconds: (number | null)[]
}

async function findAlbum(rec: Rec, sides: Side[]): Promise<Found | null> {
  const known = read<Record<string, Found | { none: number }>>(ALBUMS) || {}
  const hit = known[rec.releaseId]
  if (hit && 'id' in hit && hit.seconds) return hit
  // Don't ask again for a day about an album that wasn't there.
  if (hit && 'none' in hit && Date.now() - hit.none < 86_400_000) return null
  const want = sides.flatMap((s) => s.tracks)
  const artist = rec.artist && rec.artist !== 'Various' ? ` artist:${rec.artist}` : ''
  const found = await api(`search?${new URLSearchParams({ q: `album:${rec.title}${artist}`, type: 'album', limit: '5' })}`)
  const candidates = (found?.albums?.items || []).slice(0, 3)
  const albums = await Promise.all(
    candidates.map(async (a: any) => ({ id: a.id, tracks: (await api(`albums/${a.id}/tracks?limit=50`))?.items || [] })),
  )
  const best = bestAlbum(albums, want)
  const result = best ? { id: best.id, uris: best.uris, seconds: best.seconds } : null
  known[rec.releaseId] = result || { none: Date.now() }
  write(ALBUMS, known)
  return result
}

/**
 * The sides with Spotify's lengths filling in where Discogs has none, once the album
 * has been found. Without lengths, the grooves can only be guessed at.
 */
export function filled(rec: Rec, sides: Side[]): Side[] {
  const hit = read<Record<string, Found | { none: number }>>(ALBUMS)?.[rec.releaseId]
  if (!hit || !('seconds' in hit) || !hit.seconds) return sides
  let start = 0
  return sides.map((s) => {
    const side = withLengths(s, hit.seconds.slice(start, start + s.tracks.length)) as Side
    start += s.tracks.length
    return side
  })
}

// ---------------------------------------------------------------------------
// Needle down, needle up

/**
 * Must be called straight from the touch, before anything is awaited: iOS only lets
 * audio start inside a user gesture.
 */
export function wake() {
  player?.activateElement?.()
}

/** The cover, as the app has it: cached with the snapshot, or Discogs' or the archive's. */
export function coverOf(rec: Rec) {
  return rec.cover ? new URL(`${import.meta.env.BASE_URL}${rec.cover}`, location.origin).href : rec.remoteCover || ''
}

/** The phone's lock screen and headphone buttons, as for any music player. */
function showOnLockScreen() {
  const now = state.now
  if (!('mediaSession' in navigator) || !now) return
  const title = now.sides[now.face]?.tracks[now.track]?.title || now.rec.title
  const cover = coverOf(now.rec)
  const ms = navigator.mediaSession
  if (ms.metadata?.title !== title) {
    ms.metadata = new MediaMetadata({ title, artist: now.rec.artist, album: now.rec.title, artwork: cover ? [{ src: cover }] : [] })
  }
  ms.playbackState = now.paused ? 'paused' : 'playing'
  ms.setActionHandler('play', () => toggle())
  ms.setActionHandler('pause', () => toggle())
  ms.setActionHandler('nexttrack', () => next())
  ms.setActionHandler('previoustrack', () => previous())
}

/**
 * Play a side from where the needle went down. Where that is depends on the track
 * lengths, which may only be known once the album is found, so `at` is asked then.
 * Returns why not, if it can't.
 */
export async function drop(
  rec: Rec,
  face: number,
  sides: Side[],
  at: (side: Side) => { track: number; offset: number } | null,
  route = `r/${rec.id}`,
): Promise<string | null> {
  if (!state.connected) return 'Connect Spotify in Settings to play your records'
  if (!state.ready || !deviceId) return 'Spotify is still starting up'
  const album = await findAlbum(rec, sides).catch(() => null)
  if (!album) return "Couldn't find this album on Spotify"
  const where = at(filled(rec, sides)[face])
  if (!where) return null
  const { track, offset: seconds } = where
  const start = sides.slice(0, face).reduce((n, s) => n + s.tracks.length, 0)
  if (!album.uris[start + track]) return "That track isn't on Spotify's version"
  // Every track Spotify has, from the one touched to the end of the last side.
  queue = []
  sides.forEach((s, f) => {
    const first = sides.slice(0, f).reduce((n, x) => n + x.tracks.length, 0)
    s.tracks.forEach((_, t) => {
      const uri = album.uris[first + t]
      if (uri && (f > face || (f === face && t >= track))) queue.push({ uri, face: f, track: t })
    })
  })
  set({
    now: { recId: rec.id, rec, sides, route, face, track, position: seconds * 1000, duration: 0, paused: false, at: Date.now() },
  })
  try {
    await api(`me/player/play?device_id=${deviceId}`, {
      method: 'PUT',
      body: JSON.stringify({ uris: queue.map((q) => q.uri), position_ms: Math.round(seconds * 1000) }),
    })
    return null
  } catch {
    set({ now: null })
    return "Spotify wouldn't play it"
  }
}

/** Lift the needle, or put it back down where it was. */
export function toggle() {
  if (!player || !state.now) return
  wake()
  if (state.now.paused) player.resume()
  else player.pause()
}
export const lift = toggle

export function next() {
  player?.nextTrack()
}

/** Back to the start of this track, or the one before if it's only just begun. */
export function previous() {
  player?.previousTrack()
}

/** Take the needle off altogether: another record, or the other side. */
export function stop() {
  if (!state.now) return
  player?.pause()
  set({ now: null })
}
