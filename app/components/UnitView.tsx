import { resetSorted, toggleSorted, useStore } from '../store'
import { back, go } from '../route'
import { cubePlace, yearOf } from '../where'
import { UnitMap } from './UnitMap'
import { CubeStrip } from './RecordView'
import { BackIcon, CheckIcon, ChevronIcon, GearIcon } from './Icons'
import { Sleeve } from './Sleeve'

/** The whole unit at a glance; tap a cube to see what stands in it. */
export function UnitView() {
  const store = useStore()
  if (!store) return null
  const { built, byId } = store
  const outIds = new Set(store.out.map((r) => r.id))
  const sortedCubes = built.slots.filter(
    (c) => c.count && (store.local.sorted[c.index] || []).length >= c.count,
  ).length

  return (
    <div className="page unit-page">
      <div className="title-row">
        <h1 className="page-title">The unit</h1>
        <button type="button" className="icon-btn" onClick={() => go('settings')} aria-label="Settings">
          <GearIcon />
        </button>
      </div>
      <p className="page-sub">
        {store.records.length} records across {built.slots.length} cubes
        {built.unplaced.length ? ` · ${built.unplaced.length} with nowhere to go` : ''}
      </p>

      <UnitMap built={built} byId={byId} spines marked={outIds} onCube={(i) => go(`unit/${i}`)} />

      <h3 className="section-title">Cubes</h3>
      <ul className="cube-list">
        {built.slots.map((c) => {
          const done = (store.local.sorted[c.index] || []).filter((id) => c.instanceIds.includes(id)).length
          return (
            <li key={c.index}>
              <button type="button" className="cube-row" onClick={() => go(`unit/${c.index}`)}>
                <span className="cube-row-label">{c.label}</span>
                <span className="cube-row-place">{cubePlace(c, built)}</span>
                <span className={`cube-row-count ${c.over ? 'over' : ''}`}>
                  {done > 0 && done < c.count ? `${done}/` : ''}
                  {c.count}
                  {done >= c.count && c.count > 0 && <CheckIcon />}
                </span>
                <ChevronIcon />
              </button>
            </li>
          )
        })}
      </ul>
      {sortedCubes > 0 && (
        <p className="hint-note">
          {sortedCubes} of {built.slots.length} cubes checked in order.
        </p>
      )}
    </div>
  )
}

/**
 * One cube, every record in shelf order. Doubles as the checklist for sorting the
 * real shelf to match: tick each record as you put it in its place.
 */
export function CubeView({ index }: { index: number }) {
  const store = useStore()
  if (!store) return null
  const { built, byId } = store
  const cube = built.slots[index]
  if (!cube) return null
  const sorted = new Set(store.local.sorted[index] || [])
  const done = cube.instanceIds.filter((id) => sorted.has(id)).length
  const outIds = new Set(store.out.map((r) => r.id))
  const prev = built.slots[index - 1]
  const next = built.slots[index + 1]

  return (
    <div className="page cube-page">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => back('unit')} aria-label="Back">
          <BackIcon />
        </button>
        <div className="topbar-nav">
          {prev && (
            <button type="button" className="chip" onClick={() => go(`unit/${prev.index}`, true)}>
              ← {prev.label}
            </button>
          )}
          {next && (
            <button type="button" className="chip" onClick={() => go(`unit/${next.index}`, true)}>
              {next.label} →
            </button>
          )}
        </div>
      </header>

      <p className="eyebrow">{cubePlace(cube, built) || 'The cube'}</p>
      <h1 className="where-label">{cube.label}</h1>
      <p className="page-sub">
        {cube.count} records · {Math.round((cube.width / built.capacity) * 100)}% full
        {cube.over ? ' — over capacity' : ''}
      </p>

      <UnitMap built={built} byId={byId} highlight={[index]} compact onCube={(i) => go(`unit/${i}`, true)} />
      <div className="cube-zoom">
        <CubeStrip cubeIds={cube.instanceIds} byId={byId} capacity={built.capacity} marked={outIds} />
      </div>

      <div className="sort-head">
        <div>
          <h3 className="section-title flush">In shelf order</h3>
          <p className="sort-progress">
            {done === 0
              ? 'Tick records off as you put them in place.'
              : done >= cube.count
                ? 'This cube is in order.'
                : `${done} of ${cube.count} in place`}
          </p>
        </div>
        {done > 0 && (
          <button type="button" className="link-btn" onClick={() => resetSorted(index)}>
            Start again
          </button>
        )}
      </div>
      <div className="progress">
        <span style={{ width: `${(done / Math.max(1, cube.count)) * 100}%` }} />
      </div>

      <ol className="order-list">
        {cube.instanceIds.map((id, i) => {
          const r = byId.get(id)
          if (!r) return null
          const on = sorted.has(id)
          return (
            <li key={id} className={`order-item ${on ? 'on' : ''}`}>
              <span className="order-n">{i + 1}</span>
              <button type="button" className="order-main" onClick={() => go(`r/${id}`)}>
                <Sleeve rec={r} className="order-sleeve" />
                <span className="result-text">
                  <span className="result-title">{r.title}</span>
                  <span className="result-artist">
                    {r.artist}
                    {yearOf(r) ? ` · ${yearOf(r)}` : ''}
                    {outIds.has(id) ? ' · out' : ''}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className={`tick ${on ? 'on' : ''}`}
                onClick={() => toggleSorted(index, id)}
                aria-label={on ? 'Not in place' : 'In place'}
                aria-pressed={on}
              >
                <CheckIcon />
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
