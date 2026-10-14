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

/**
 * Keep the field you're typing in — and its Save button — above the keyboard. Phone
 * browsers (Chrome on Android since 108, and Safari) lay the keyboard over the page
 * rather than shrinking it, don't reliably scroll a field into view when it appears
 * from tapping something else, and near the bottom of a page there's no room to
 * scroll it up anyway; so
 * while typing the page gets extra room below, and the field's form is scrolled
 * clear of the keyboard whenever it opens or resizes.
 */
const isTextField = (el: Element | null) =>
  Boolean(el?.matches('input:not([type=checkbox]):not([type=radio]):not([type=file]), textarea'))

function keepFieldInView() {
  const el = document.activeElement as HTMLElement | null
  if (!isTextField(el)) return
  const box = (el!.closest('form, .search-box') as HTMLElement | null) || el!
  const vv = window.visualViewport
  const visibleBottom = vv ? vv.offsetTop + vv.height : window.innerHeight
  const over = box.getBoundingClientRect().bottom + 16 - visibleBottom
  if (over > 0) window.scrollBy({ top: over, behavior: 'smooth' })
}

document.addEventListener('focusin', (e) => {
  if (!isTextField(e.target as Element)) return
  document.body.classList.add('typing')
  // Once the keyboard has had time to come up.
  setTimeout(keepFieldInView, 350)
})
document.addEventListener('focusout', () => {
  setTimeout(() => {
    const el = document.activeElement
    if (!isTextField(el) && !el?.closest('.edit-box')) document.body.classList.remove('typing')
  }, 150)
})
window.visualViewport?.addEventListener('resize', keepFieldInView)

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
