import { useEffect, useState } from 'react'

/**
 * Hash routing — GitHub Pages serves one index.html, and a hash survives a reload
 * and the phone's back gesture without any server help.
 *
 *   #/            find
 *   #/scan        camera
 *   #/r/123       where record 123 goes
 *   #/out         records out of the shelf
 *   #/unit        the whole unit
 *   #/unit/4      one cube, in order
 *   #/settings
 *   #/shelf/metal  one shelf: its name and records
 *   #/artist/10346 an artist's albums, yours and the rest (Discogs artist id)
 *   #/mb/<mbid>    the same for someone with no page of their own (a band member)
 *   #/stats
 */
export type Route =
  | { name: 'find' }
  | { name: 'scan' }
  | { name: 'record'; id: number }
  | { name: 'out' }
  | { name: 'unit' }
  | { name: 'cube'; index: number }
  | { name: 'settings' }
  | { name: 'shelf'; id: string }
  | { name: 'artist'; id: number }
  | { name: 'mb'; id: string }
  | { name: 'stats' }

export function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/')
  switch (parts[0]) {
    case 'scan':
      return { name: 'scan' }
    case 'r':
      return { name: 'record', id: Number(parts[1]) }
    case 'out':
      return { name: 'out' }
    case 'unit':
      return parts[1] ? { name: 'cube', index: Number(parts[1]) } : { name: 'unit' }
    case 'settings':
      return { name: 'settings' }
    case 'shelf':
      return { name: 'shelf', id: decodeURIComponent(parts[1] || '') }
    case 'artist':
      return { name: 'artist', id: Number(parts[1]) }
    case 'mb':
      return { name: 'mb', id: decodeURIComponent(parts[1] || '') }
    case 'stats':
      return { name: 'stats' }
    default:
      return { name: 'find' }
  }
}

/** How many in-app pushes deep we are, so Back never leaves the app. */
let depth = 0
window.addEventListener('popstate', () => {
  depth = Math.max(0, depth - 1)
})

export function go(path: string, replace = false) {
  const hash = `#/${path.replace(/^\//, '')}`
  if (replace) history.replaceState(null, '', hash)
  else {
    history.pushState(null, '', hash)
    depth++
  }
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}

/** Back if we came from inside the app, otherwise to a sensible parent. */
export function back(fallback = '') {
  if (depth > 0) history.back()
  else go(fallback, true)
}

export function useRoute() {
  const [route, setRoute] = useState(() => parse(location.hash))
  useEffect(() => {
    const on = () => setRoute(parse(location.hash))
    window.addEventListener('hashchange', on)
    window.addEventListener('popstate', on)
    return () => {
      window.removeEventListener('hashchange', on)
      window.removeEventListener('popstate', on)
    }
  }, [])
  return route
}
