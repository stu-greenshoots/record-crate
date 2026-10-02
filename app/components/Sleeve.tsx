import { useState } from 'react'
import { coverUrl } from '../store'
import type { Rec } from '../types'

/** A sleeve that fades in once loaded and falls back to its spine colour. */
export function Sleeve({ rec, className = '', eager = false }: { rec: Rec; className?: string; eager?: boolean }) {
  const [loaded, setLoaded] = useState(false)
  const src = coverUrl(rec)
  return (
    <span className={`sleeve ${loaded ? 'loaded' : ''} ${className}`} style={{ background: rec.colour || undefined }}>
      {src && (
        <img
          src={src}
          alt=""
          loading={eager ? 'eager' : 'lazy'}
          decoding="async"
          onLoad={() => setLoaded(true)}
          // A cached image can finish before React is listening for the event.
          ref={(el) => {
            if (el?.complete && el.naturalWidth) setLoaded(true)
          }}
          draggable={false}
        />
      )}
    </span>
  )
}
