import { memo } from 'react'
import type { BuiltMap, Rec } from '../types'

interface Props {
  built: BuiltMap
  byId: Map<number, Rec>
  /** Draw every record as a spine, rather than just the cube labels. */
  spines?: boolean
  /** Cubes to light up. */
  highlight?: number[]
  /** One record to pick out among the spines. */
  focus?: number
  /** Little counters on cubes, e.g. records waiting to go back. */
  badges?: Record<number, number>
  /** Records to mark among the spines (out of the shelf). */
  marked?: Set<number>
  /** Records a filter lets through: they glow, everything else dims. */
  matched?: Set<number> | null
  onCube?: (index: number) => void
  compact?: boolean
}

/**
 * The furniture, drawn to scale: a grid of cubes, each with its records standing in
 * it as spines coloured from their sleeves. Spine width comes from the cube's
 * capacity, not its contents, so a half-empty cube reads as half empty.
 */
export const UnitMap = memo(function UnitMap({
  built,
  byId,
  spines = false,
  highlight = [],
  focus,
  badges = {},
  marked,
  matched,
  onCube,
  compact = false,
}: Props) {
  const lit = new Set(highlight)
  const dimOthers = lit.size > 0
  return (
    <div
      className={`unit ${compact ? 'compact' : ''} ${spines ? 'with-spines' : ''} ${matched ? 'filtering' : ''}`}
      style={{ gridTemplateColumns: `repeat(${built.cols}, 1fr)` }}
    >
      {built.slots.map((cube) => {
        const on = lit.has(cube.index)
        const badge = badges[cube.index]
        const none = matched && !cube.instanceIds.some((id) => matched.has(id))
        return (
          <button
            key={cube.index}
            type="button"
            className={`cube ${on ? 'lit' : ''} ${(dimOthers && !on) || none ? 'dim' : ''} ${cube.over ? 'over' : ''}`}
            onClick={onCube ? () => onCube(cube.index) : undefined}
            tabIndex={onCube ? 0 : -1}
            aria-label={`${cube.label}, ${cube.count} records`}
          >
            {spines && (
              <span className="spines" aria-hidden>
                {cube.instanceIds.map((id) => {
                  const r = byId.get(id)
                  if (!r) return null
                  const isFocus = id === focus
                  return (
                    <i
                      key={id}
                      className={`${isFocus ? 'focus' : ''} ${marked?.has(id) ? 'marked' : ''} ${matched?.has(id) ? 'match' : ''}`}
                      style={{
                        width: `${(r.width / built.capacity) * 100}%`,
                        height: `${Math.min(1, r.height) * 100}%`,
                        background: r.colour || undefined,
                      }}
                    />
                  )
                })}
              </span>
            )}
            <span className="cube-label">{cube.label}</span>
            {badge ? <span className="cube-badge">{badge}</span> : null}
          </button>
        )
      })}
    </div>
  )
})
