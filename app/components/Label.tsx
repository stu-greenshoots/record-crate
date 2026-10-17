import { useState } from 'react'
import type { Rec } from '../types'

/**
 * The record's centre label: the photo from Discogs, cropped to the circle, where the
 * snapshot found one. Otherwise a plain label printed from what we know, coloured
 * from the sleeve so the middle of the platter never looks like a hole.
 */
export function RecordLabel({ rec }: { rec: Rec }) {
  const [failed, setFailed] = useState(false)
  if (rec.labelArt && !failed) {
    return (
      <span className="disc-label">
        <img
          src={`${import.meta.env.BASE_URL}${rec.labelArt}`}
          alt={`Label of ${rec.title}`}
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
        {rec.catno}
        {rec.catno ? ' · ' : ''}33⅓
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
