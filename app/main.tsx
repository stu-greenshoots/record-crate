import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { load } from './store'
import { warmUp } from './recognise'
import './styles.css'

load().catch((err) => {
  document.getElementById('root')!.textContent = String(err.message || err)
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
