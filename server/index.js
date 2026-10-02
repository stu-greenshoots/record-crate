import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import { config, ROOT, assertCredentials } from './config.js'
import { router } from './routes.js'
import { store } from './store.js'
import { startEnrichment } from './enrich.js'

const app = express()
// Behind a tunnel (ngrok/cloudflared) TLS is terminated upstream; without this the
// OAuth callback would be built as http:// and Discogs would refuse the redirect.
app.set('trust proxy', true)

/**
 * The app has no login of its own — it is built to sit on localhost. When it is
 * exposed through a tunnel, ACCESS_CODE puts a shared passcode in front of
 * everything so a stray visitor can't read the collection or hijack the OAuth flow.
 * The browser caches the credentials for the origin, so the Discogs callback still
 * comes back through cleanly.
 */
if (process.env.ACCESS_CODE) {
  const expected = process.env.ACCESS_CODE
  app.use((req, res, next) => {
    const [scheme, encoded] = (req.get('authorization') || '').split(' ')
    if (scheme === 'Basic' && encoded) {
      const pass = Buffer.from(encoded, 'base64').toString().split(':')[1]
      if (pass === expected) return next()
    }
    res.set('WWW-Authenticate', 'Basic realm="Record Crate"')
    res.status(401).end('Passcode required')
  })
}

app.use(express.json({ limit: '2mb' }))
app.use('/api', router)

if (config.isProd) {
  const dist = path.join(ROOT, 'dist')
  if (!fs.existsSync(dist)) {
    console.error('No dist/ build found. Run `npm run build` first.')
    process.exit(1)
  }
  app.use(express.static(dist))
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')))
} else {
  // Vite in middleware mode keeps the whole thing on one port with HMR intact.
  const { createServer } = await import('vite')
  const vite = await createServer({
    root: ROOT,
    server: { middlewareMode: true },
    appType: 'spa',
  })
  app.use(vite.middlewares)
}

try {
  assertCredentials()
} catch (err) {
  console.error(`\n  ${err.message}\n`)
  process.exit(1)
}

app.listen(config.port, () => {
  const url = `http://localhost:${config.port}`
  console.log(`\n  ◉  Record Crate  →  ${url}`)
  console.log(
    store.auth
      ? `     Signed in as ${store.auth.username} · ${store.collection.items.length} records on the shelves\n`
      : '     Not connected yet — open the page and hit "Connect Discogs"\n',
  )
  // A second instance (e.g. an ungated one for local testing) shouldn't run a
  // competing crawl against the same token and rate limit.
  if (store.auth && store.collection.items.length && !process.env.DISABLE_ENRICH) {
    startEnrichment()
  }
})
