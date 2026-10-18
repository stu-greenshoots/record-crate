import { applyFilter, randomFilter, useMatches } from '../filter'
import { isEmpty } from '../../shared/filter.js'
import { go } from '../route'
import type { Derived } from '../store'
import type { Rec } from '../types'
import { FilterBar } from './FilterBar'
import { DiceIcon } from './Icons'
import { toast } from './Toast'

/** The record the dice last put on the platter, so it can offer another. */
let lastPick: number | null = null

/** What the dice can land on: on the shelf, on the unit, and through the random choices. */
function candidates(store: Derived) {
  const filter = randomFilter.get(store.snapshot.exportedAt)
  return applyFilter(store.records, filter).filter((r) => !store.local.out[r.id] && store.spots.has(r.id))
}

/** Put a random record on the platter. False when nothing's left to pick from. */
export function pickRandom(store: Derived, current: number | null) {
  const all = candidates(store)
  const pool = all.length > 1 ? all.filter((r) => r.id !== current) : all
  if (!pool.length) {
    toast('Nothing on the shelf matches your random choices')
    return false
  }
  const rec = pool[Math.floor(Math.random() * pool.length)]
  lastPick = rec.id
  go(`r/${rec.id}`)
  return true
}

/** Under a record the dice chose: what it was chosen from, and another go. */
export function RandomBar({ store, rec, onChange }: { store: Derived; rec: Rec; onChange: () => void }) {
  const filter = randomFilter.use(store.snapshot.exportedAt)
  if (rec.id !== lastPick) return null
  return (
    <div className="random-bar">
      <DiceIcon />
      <span>{isEmpty(filter) ? 'Random pick' : `Random, from ${candidates(store).length}`}</span>
      <button type="button" className="link-btn" onClick={onChange}>
        Change
      </button>
      <button type="button" className="chip on" onClick={() => pickRandom(store, rec.id)}>
        Another
      </button>
    </div>
  )
}

/** The random choices: the same filters as the unit, kept on the phone. */
export function RandomSheet({ store, current, onClose }: { store: Derived; current: number | null; onClose: () => void }) {
  const base = store.snapshot.exportedAt
  const filter = randomFilter.use(base)
  const { matched, pool } = useMatches(store.records, filter)
  const count = candidates(store).length
  return (
    <div className="search-sheet filter-sheet" role="dialog" aria-label="Random choices">
      <div className="filter-sheet-head">
        <h2>Pick at random</h2>
        <button type="button" className="btn btn-small btn-ghost" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="hint-note">
        Narrow what the dice can land on. It only picks records that are on the shelf, and remembers your choices.
      </p>
      <FilterBar
        store={store}
        filter={filter}
        onChange={(f) => randomFilter.set(f, base)}
        matched={matched}
        pool={pool}
        counted={false}
      />
      <button
        type="button"
        className="btn btn-big btn-mustard random-go"
        disabled={!count}
        onClick={() => {
          if (pickRandom(store, current)) onClose()
        }}
      >
        <DiceIcon />
        {count ? `Pick one of ${count}` : 'Nothing to pick from'}
      </button>
    </div>
  )
}
