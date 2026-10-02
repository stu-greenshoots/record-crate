import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { load } from './store'
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
