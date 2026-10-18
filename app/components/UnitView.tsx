import { useEffect, useRef, useState } from 'react'
import { resetSorted, toggleSorted, useStore } from '../store'
import { useMatches } from '../filter'
import { FilterBar } from './FilterBar'
import { back, go } from '../route'
import { cubePlace, yearOf } from '../where'
import { UnitMap } from './UnitMap'
import { CubeStrip } from './RecordDetails'
import { BackIcon, CheckIcon, ChevronIcon, GearIcon } from './Icons'
import { Sleeve } from './Sleeve'

/** The whole unit at a glance; tap a cube to see what stands in it. */
export function UnitView() {
  const store = useStore()
  if (!store) return null
  return <Unit store={store} />
}

function Unit({ store }: { store: NonNullable<ReturnType<typeof useStore>> }) {
  const { built, byId } = store
  const { filter, matched, pool } = useMatches(store.records, store.snapshot.exportedAt)
  const hits = (ids: number[]) => (matched ? ids.filter((id) => matched.has(id)).length : 0)
  const badges = matched ? Object.fromEntries(built.slots.map((c) => [c.index, hits(c.instanceIds)])) : {}
  const outIds = new Set(store.out.map((r) => r.id))
  const sortedCubes = built.slots.filter(
    (c) => c.count && (store.local.sorted[c.index] || []).filter((id) => c.instanceIds.includes(id)).length >= c.count,
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

      <FilterBar store={store} filter={filter} matched={matched} pool={pool} />

      <UnitMap
        built={built}
        byId={byId}
        spines
        marked={outIds}
        matched={matched}
        badges={badges}
        onCube={(i) => go(`unit/${i}`)}
      />

      <h3 className="section-title">{matched ? 'Cubes with matches' : 'Cubes'}</h3>
      <ul className="cube-list">
        {built.slots.map((c) => {
          if (matched && !badges[c.index]) return null
          const done = (store.local.sorted[c.index] || []).filter((id) => c.instanceIds.includes(id)).length
          return (
            <li key={c.index}>
              <button type="button" className="cube-row" onClick={() => go(`unit/${c.index}`)}>
                <span className="cube-row-label">{c.label}</span>
                <span className="cube-row-place">{cubePlace(c, built)}</span>
                {matched ? (
                  <span className="cube-row-count">
                    <b>{badges[c.index]}</b>&nbsp;of {c.count}
                  </span>
                ) : (
                  <span className={`cube-row-count ${c.over ? 'over' : ''}`}>
                    {done > 0 && done < c.count ? `${done}/` : ''}
                    {c.count}
                    {done >= c.count && c.count > 0 && <CheckIcon />}
                  </span>
                )}
                <ChevronIcon />
              </button>
            </li>
          )
        })}
      </ul>
      {!matched && sortedCubes > 0 && (
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
  return <CubePage store={store} index={index} />
}

function CubePage({ store, index }: { store: NonNullable<ReturnType<typeof useStore>>; index: number }) {
  const { built, byId } = store
  const { matched } = useMatches(store.records, store.snapshot.exportedAt)
  const [only, setOnly] = useState(false)
  const firstMatch = useRef<HTMLLIElement>(null)
  // Arriving from a filtered unit: take you to the first match in the list.
  useEffect(() => {
    firstMatch.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [index])
  const cube = built.slots[index]
  if (!cube) {
    return (
      <div className="page cube-page">
        <header className="topbar">
          <button type="button" className="icon-btn" onClick={() => go('unit', true)} aria-label="Back">
            <BackIcon />
          </button>
        </header>
        <p className="empty-note">That cube isn't on the unit any more.</p>
      </div>
    )
  }
  const sorted = new Set(store.local.sorted[index] || [])
  const done = cube.instanceIds.filter((id) => sorted.has(id)).length
  const outIds = new Set(store.out.map((r) => r.id))
  const hits = matched ? cube.instanceIds.filter((id) => matched.has(id)).length : 0
  const firstHit = matched ? cube.instanceIds.find((id) => matched.has(id)) : undefined
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
        <CubeStrip cubeIds={cube.instanceIds} byId={byId} capacity={built.capacity} marked={outIds} matched={matched} />
      </div>

      {matched && (
        <div className="cube-matches">
          <p>
            {hits ? `${hits} of ${cube.count} match your filter` : 'Nothing here matches your filter'}
          </p>
          {hits > 0 && (
            <button type="button" className={`chip ${only ? 'on' : ''}`} aria-pressed={only} onClick={() => setOnly(!only)}>
              Matches only
            </button>
          )}
        </div>
      )}

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
          const hit = matched?.has(id)
          if (only && !hit) return null
          return (
            <li
              key={id}
              ref={hit && id === firstHit ? firstMatch : undefined}
              className={`order-item ${on ? 'on' : ''} ${hit ? 'match' : matched ? 'unmatched' : ''}`}
            >
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
