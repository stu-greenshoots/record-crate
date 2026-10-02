import crypto from 'node:crypto'
import { config, assertCredentials } from './config.js'
import { store } from './store.js'

/**
 * Discogs accepts the PLAINTEXT signature method over HTTPS, so the whole OAuth 1.0a
 * dance needs no signing library — the signature is just the two secrets joined by "&".
 */
function authHeader(extra = {}, tokenSecret = '') {
  assertCredentials()
  const params = {
    oauth_consumer_key: config.consumerKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature: `${encodeURIComponent(config.consumerSecret)}&${encodeURIComponent(tokenSecret)}`,
    oauth_signature_method: 'PLAINTEXT',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_version: '1.0',
    ...extra,
  }
  const parts = Object.entries(params).map(([k, v]) => `${k}="${encodeURIComponent(v)}"`)
  return `OAuth ${parts.join(', ')}`
}

function parseForm(text) {
  return Object.fromEntries(new URLSearchParams(text).entries())
}

export async function getRequestToken(callbackUrl) {
  const res = await fetch(config.requestTokenUrl, {
    headers: {
      Authorization: authHeader({ oauth_callback: callbackUrl }),
      'User-Agent': config.userAgent,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Discogs request_token failed (${res.status}): ${text}`)
  return parseForm(text)
}

export async function getAccessToken(token, tokenSecret, verifier) {
  const res = await fetch(config.accessTokenUrl, {
    method: 'POST',
    headers: {
      Authorization: authHeader({ oauth_token: token, oauth_verifier: verifier }, tokenSecret),
      'User-Agent': config.userAgent,
    },
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`Discogs access_token failed (${res.status}): ${text}`)
  return parseForm(text)
}

export function authorizeUrlFor(token) {
  return `${config.authorizeUrl}?oauth_token=${encodeURIComponent(token)}`
}

/* ------------------------------------------------------------------ */
/* Rate-limited API client                                             */
/* ------------------------------------------------------------------ */

/**
 * Discogs allows 60 authenticated requests/minute. We run a small token bucket a
 * little under that, with a two-level queue so anything the user is waiting on
 * overtakes the background enrichment crawl.
 */
class RateLimiter {
  constructor({ capacity = 8, refillPerMinute = 50 } = {}) {
    this.capacity = capacity
    this.tokens = capacity
    this.intervalMs = 60000 / refillPerMinute
    this.queues = [[], []] // 0 = interactive, 1 = background
    this.timer = null
    this.pausedUntil = 0
    setInterval(() => {
      this.tokens = Math.min(this.capacity, this.tokens + 1)
      this.pump()
    }, this.intervalMs).unref()
  }

  schedule(priority = 1) {
    return new Promise((resolve) => {
      this.queues[priority].push(resolve)
      this.pump()
    })
  }

  pump() {
    if (Date.now() < this.pausedUntil) return
    while (this.tokens > 0) {
      const next = this.queues[0].shift() || this.queues[1].shift()
      if (!next) return
      this.tokens -= 1
      next()
    }
  }

  pause(ms) {
    this.pausedUntil = Math.max(this.pausedUntil, Date.now() + ms)
    setTimeout(() => this.pump(), ms + 25).unref()
  }

  get depth() {
    return this.queues[0].length + this.queues[1].length
  }
}

export const limiter = new RateLimiter()

export const apiState = { remaining: null, lastError: null }

/**
 * Perform an authenticated call against the Discogs API.
 * @param {string} pathOrUrl absolute URL, or a path relative to the API base
 * @param {{priority?: 0|1, retries?: number}} opts
 */
export async function api(pathOrUrl, opts = {}) {
  const { priority = 1, retries = 3 } = opts
  if (!store.auth) throw Object.assign(new Error('Not authenticated with Discogs'), { status: 401 })

  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${config.apiBase}${pathOrUrl}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    await limiter.schedule(priority)
    let res
    try {
      res = await fetch(url, {
        headers: {
          Authorization: authHeader({ oauth_token: store.auth.token }, store.auth.tokenSecret),
          'User-Agent': config.userAgent,
          Accept: 'application/json',
        },
      })
    } catch (err) {
      if (attempt === retries) throw err
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }

    const remaining = res.headers.get('x-discogs-ratelimit-remaining')
    if (remaining != null) {
      apiState.remaining = Number(remaining)
      if (apiState.remaining <= 2) limiter.pause(20000)
    }

    if (res.status === 429) {
      limiter.pause(30000)
      if (attempt === retries) throw Object.assign(new Error('Discogs rate limit'), { status: 429 })
      continue
    }
    if (res.status === 404) return null
    if (res.status === 401) {
      throw Object.assign(new Error('Discogs authorisation expired'), { status: 401 })
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
        continue
      }
      apiState.lastError = `${res.status} ${body.slice(0, 200)}`
      throw Object.assign(new Error(`Discogs ${res.status}: ${body.slice(0, 200)}`), {
        status: res.status,
      })
    }
    return res.json()
  }
  throw new Error('Discogs request failed')
}
