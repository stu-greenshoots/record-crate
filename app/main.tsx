import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { getStore, load } from './store'
import { warmUp } from './recognise'
import { refresh } from './discogs'
import './styles.css'

/**
 * Look for records added on Discogs a little after opening, at most every few
 * hours — new purchases turn up without anyone having to remember to check.
 */
const CHECK_EVERY_MS = 6 * 3600 * 1000
load().then(() => {
  const last = getStore()?.local.lastCheck
  if (navigator.onLine && (!last || Date.now() - Date.parse(last) > CHECK_EVERY_MS)) {
    setTimeout(() => refresh({ quiet: true }), 3000)
  }
})

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {})
}

/**
 * Fetch the recogniser in the background once the app has settled, so the first
 * scan in front of the shelf doesn't wait on a 38MB download. Skipped where the
 * phone says data is precious.
 */
const connection = (navigator as Navigator & { connection?: { saveData?: boolean; type?: string } }).connection
if (!connection?.saveData && connection?.type !== 'cellular') {
  setTimeout(() => warmUp(), 4000)
}
