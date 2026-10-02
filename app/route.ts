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
 */
export type Route =
  | { name: 'find' }
  | { name: 'scan' }
  | { name: 'record'; id: number }
  | { name: 'out' }
  | { name: 'unit' }
  | { name: 'cube'; index: number }
  | { name: 'settings' }

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
