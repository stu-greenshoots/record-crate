import { putBack, takeOut, update, useStore } from '../store'
import { go } from '../route'
import { cubePlace } from '../where'
import type { Rec } from '../types'
import { UnitMap } from './UnitMap'
import { Sleeve } from './Sleeve'
import { CheckIcon } from './Icons'
import { toast } from './Toast'
import { timeAgo } from './RecordView'

/**
 * Everything off the shelf, in the order you'd walk the unit to put it back: cube by
 * cube, left to right, so a pile of records goes back in one pass.
 */
export function OutView() {
  const store = useStore()
  if (!store) return null
  const { out, spots, built, byId } = store

  if (!out.length) {
    return (
      <div className="page out-page">
        <h1 className="page-title">Put back</h1>
        <div className="empty-state">
          <span className="empty-disc" aria-hidden />
          <p>Everything's on the shelf.</p>
          <p className="empty-sub">
            When you take a record out, mark it on its page and it'll wait here until it goes back.
          </p>
          <button type="button" className="btn btn-secondary" onClick={() => go('')}>
            Find a record
          </button>
        </div>
      </div>
    )
  }

  const groups: { cube: number; recs: Rec[] }[] = []
  for (const r of out) {
    const c = spots.get(r.id)?.cube.index ?? -1
    const last = groups[groups.length - 1]
    if (last && last.cube === c) last.recs.push(r)
    else groups.push({ cube: c, recs: [r] })
  }
  const badges: Record<number, number> = {}
  groups.forEach((g) => (badges[g.cube] = g.recs.length))
  const marked = new Set(out.map((r) => r.id))

  /**
   * The nearest record still on the shelf to slot it next to. A neighbour that's
   * itself out is no use as a landmark, so step past it.
   */
  const shelfHint = (id: number) => {
    const spot = spots.get(id)
    if (!spot) return ''
    const ids = spot.cube.instanceIds
    for (let i = spot.index - 1; i >= 0; i--) {
      if (!marked.has(ids[i])) return `after ${byId.get(ids[i])?.title}`
    }
    for (let i = spot.index + 1; i < ids.length; i++) {
      if (!marked.has(ids[i])) return `first in the cube, before ${byId.get(ids[i])?.title}`
    }
    return 'the cube is empty'
  }

  const back = (r: Rec) => {
    putBack(r.id)
    toast(`${r.title} — back in`, { undo: () => takeOut(r.id) })
  }

  const allBack = () => {
    const saved = { ...store.local.out }
    update((l) => {
      l.out = {}
    })
    toast(`All ${out.length} back on the shelf`, {
      undo: () =>
        update((l) => {
          l.out = saved
        }),
    })
  }

  return (
    <div className="page out-page">
      <h1 className="page-title">
        Put back <span className="title-count">{out.length}</span>
      </h1>
      <p className="page-sub">
        {groups.length === 1 ? 'All in one cube.' : `${groups.length} cubes, in walking order.`}
      </p>

      <UnitMap
        built={built}
        byId={byId}
        spines
        highlight={groups.map((g) => g.cube)}
        badges={badges}
        marked={marked}
        onCube={(i) => go(`unit/${i}`)}
      />

      {groups.map((g, n) => {
        const cube = built.slots[g.cube]
        return (
          <section key={g.cube} className="out-group">
            <h2 className="out-cube">
              <span className="step">{n + 1}</span>
              <span className="out-cube-label">{cube ? cube.label : 'Not on the unit'}</span>
              <span className="out-cube-place">{cube ? cubePlace(cube, built) : ''}</span>
            </h2>
            <ul className="out-list">
              {g.recs.map((r) => {
                const hint = shelfHint(r.id)
                return (
                  <li key={r.id} className="out-item">
                    <button type="button" className="out-main" onClick={() => go(`r/${r.id}`)}>
                      <Sleeve rec={r} className="result-sleeve" />
                      <span className="result-text">
                        <span className="result-title">{r.title}</span>
                        <span className="result-artist">{r.artist}</span>
                        <span className="out-hint">{hint}</span>
                      </span>
                    </button>
                    <button type="button" className="tick" onClick={() => back(r)} aria-label={`${r.title} is back`}>
                      <CheckIcon />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      <div className="out-footer">
        <button type="button" className="btn btn-secondary" onClick={allBack}>
          They're all back
        </button>
        <p className="action-hint">Oldest out: {timeAgo(Math.min(...Object.values(store.local.out)))}</p>
      </div>
    </div>
  )
}
