import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = path.join(ROOT, 'data')

/**
 * The .env in this project is a tab-separated "Label<TAB>Value" table copied out of
 * the Discogs developer console rather than a conventional KEY=VALUE file, so parse
 * both shapes and normalise the labels we care about.
 */
const LABELS = {
  'consumer key': 'consumerKey',
  'consumer secret': 'consumerSecret',
  'request token url': 'requestTokenUrl',
  'authorize url': 'authorizeUrl',
  'access token url': 'accessTokenUrl',
  discogs_consumer_key: 'consumerKey',
  discogs_consumer_secret: 'consumerSecret',
}

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {}
  const out = {}
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    // Tab-separated first (label may itself contain spaces), then KEY=VALUE.
    let key, value
    if (line.includes('\t')) {
      const i = line.indexOf('\t')
      key = line.slice(0, i)
      value = line.slice(i + 1)
    } else if (line.includes('=')) {
      const i = line.indexOf('=')
      key = line.slice(0, i)
      value = line.slice(i + 1)
    } else {
      continue
    }
    const normalised = LABELS[key.trim().toLowerCase()]
    if (normalised) out[normalised] = value.trim().replace(/^["']|["']$/g, '')
  }
  return out
}

const fromFile = parseEnvFile(path.join(ROOT, '.env'))

export const config = {
  consumerKey: process.env.DISCOGS_CONSUMER_KEY || fromFile.consumerKey,
  consumerSecret: process.env.DISCOGS_CONSUMER_SECRET || fromFile.consumerSecret,
  requestTokenUrl: fromFile.requestTokenUrl || 'https://api.discogs.com/oauth/request_token',
  authorizeUrl: fromFile.authorizeUrl || 'https://www.discogs.com/oauth/authorize',
  accessTokenUrl: fromFile.accessTokenUrl || 'https://api.discogs.com/oauth/access_token',
  apiBase: 'https://api.discogs.com',
  userAgent: 'RecordCrate/0.1 +https://github.com/local/record-crate',
  port: Number(process.env.PORT || 5177),
  currency: process.env.DISCOGS_CURRENCY || 'GBP',
  isProd: process.env.NODE_ENV === 'production',
}

export function assertCredentials() {
  if (!config.consumerKey || !config.consumerSecret) {
    throw new Error(
      'Missing Discogs consumer key/secret. Expected them in .env as "Consumer Key<TAB>..." ' +
        'or as DISCOGS_CONSUMER_KEY / DISCOGS_CONSUMER_SECRET environment variables.',
    )
  }
}

fs.mkdirSync(path.join(DATA_DIR, 'releases'), { recursive: true })
