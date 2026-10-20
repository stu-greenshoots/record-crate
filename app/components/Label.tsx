import { useState } from 'react'
import type { Face, Rec } from '../types'

/**
 * The record's centre label: the photo from Discogs, cropped to the circle, where the
 * snapshot found one. Where that photo is of the whole record (a coloured or picture
 * disc), it covers the platter instead. Otherwise a plain label printed from what we know, coloured
 * from the sleeve so the middle of the platter never looks like a hole.
 */
export function RecordLabel({ rec, face }: { rec: Rec; face: Face }) {
  const [failed, setFailed] = useState(false)
  const label = labelFor(rec, face, failed, setFailed)
  if (!face.under) return label
  return (
    <>
      <span className="disc-under" aria-hidden>
        <img src={`${import.meta.env.BASE_URL}${face.under}`} alt="" draggable={false} />
      </span>
      {label}
    </>
  )
}

function labelFor(rec: Rec, face: Face, failed: boolean, setFailed: (v: boolean) => void) {
  if (face.art && !failed) {
    return (
      <span className={`disc-label ${face.disc ? 'whole' : ''}`}>
        <img
          src={`${import.meta.env.BASE_URL}${face.art}`}
          alt={face.disc ? `${rec.title}, side ${face.side}` : `Label of ${rec.title}, side ${face.side}`}
          draggable={false}
          onError={() => setFailed(true)}
        />
      </span>
    )
  }
  return (
    <span
      className="disc-label printed"
      style={{ backgroundColor: rec.colour || undefined, color: inkOn(rec.colour) }}
      aria-label={`Label of ${rec.title}`}
    >
      <span className="printed-top">{rec.label}</span>
      <span className="printed-title">{rec.title}</span>
      <span className="printed-hole" />
      <span className="printed-artist">{rec.artist}</span>
      <span className="printed-bottom">
        Side {face.side}
        {rec.catno ? ` · ${rec.catno}` : ''}
      </span>
    </span>
  )
}

/** Dark print on a light label, cream on a dark one. */
function inkOn(colour?: string | null) {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(colour || '')
  if (!m) return '#1d1a19'
  const [r, g, b] = m.slice(1).map((n) => Number(n) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? '#1d1a19' : '#fbf4e8'
}
