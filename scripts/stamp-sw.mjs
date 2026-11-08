/**
 * Fill in the service worker's placeholders (see public/sw.js). Throws if one is
 * missing, so a build can't quietly ship a worker that never renames its caches.
 */
export function stampServiceWorker(source, { build, runtime, assets }) {
  const stamps = {
    "'__BUILD__'": `'${build}'`,
    "'__RUNTIME__'": `'${runtime}'`,
    '/*__ASSETS__*/ []': JSON.stringify(assets),
  }
  for (const [from, to] of Object.entries(stamps)) {
    if (!source.includes(from)) throw new Error(`sw.js has no ${from} to fill in`)
    source = source.replace(from, () => to)
  }
  return source
}
