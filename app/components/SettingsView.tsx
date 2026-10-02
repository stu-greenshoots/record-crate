import { useEffect, useState } from 'react'
import { setMap, update, useStore } from '../store'
import { back, go } from '../route'
import { checkDiscogs, checkRunning, type CheckProgress } from '../discogs'
import type { ShelfMapConfig, SlotConfig } from '../types'
import { BackIcon } from './Icons'
import { UnitMap } from './UnitMap'
import { toast } from './Toast'
import { timeAgo } from './RecordView'

export function SettingsView() {
  const store = useStore()
  const [editing, setEditing] = useState<number | null>(null)
  const [checking, setChecking] = useState<CheckProgress | null>(null)
  const [checkError, setCheckError] = useState<string | null>(null)
  if (!store) return null
  const { map, built, snapshot } = store

  const change = (fn: (m: ShelfMapConfig) => void) => {
    const next = structuredClone(map)
    fn(next)
    fitSlots(next)
    setMap(next)
    if (editing !== null && editing >= next.cols * next.rows) setEditing(null)
  }

  /** Give a shelf to this cube alone, or take it away. */
  const toggleShelf = (cube: number, shelfId: string) =>
    change((m) => {
      const cur: SlotConfig = m.slots[cube]
      const ids = new Set(cur.type === 'shelves' ? cur.shelfIds || [] : [])
      if (ids.has(shelfId)) ids.delete(shelfId)
      else {
        if (cur.type === 'flow' && flowCount(m) <= 1) {
          toast('One cube has to hold the A–Z run')
          return
        }
        ids.add(shelfId)
        // A shelf lives in one place, so take it out of any other cube.
        m.slots.forEach((other, i) => {
          if (i === cube || other.type !== 'shelves') return
          const rest = (other.shelfIds || []).filter((x) => x !== shelfId)
          m.slots[i] = rest.length ? { type: 'shelves', shelfIds: rest } : { type: 'flow' }
        })
      }
      m.slots[cube] = ids.size ? { type: 'shelves', shelfIds: [...ids] } : { type: 'flow' }
    })

  const visible = map.slots.slice(0, map.cols * map.rows)
  const homeless = snapshot.shelves.filter(
    (sh) =>
      sh.id !== map.flowShelf &&
      !visible.some((sl) => sl.type === 'shelves' && (sl.shelfIds || []).includes(sh.id)) &&
      store.records.some((r) => r.shelf === sh.id),
  )
  const newerSnapshot = Boolean(store.local.map && store.local.mapBase !== snapshot.exportedAt)

  useEffect(() => {
    // Pick a check back up if one was left running.
    if (checkRunning()) runCheck()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const runCheck = async () => {
    setCheckError(null)
    setChecking({ stage: 'Starting' })
    try {
      const { added, gone } = await checkDiscogs(setChecking)
      toast(
        added.length || gone
          ? `${added.length} new${gone ? `, ${gone} gone` : ''}`
          : 'Up to date — nothing new on Discogs',
      )
    } catch (err) {
      setCheckError(String((err as Error).message || err))
    } finally {
      setChecking(null)
    }
  }

  const slot = editing !== null ? map.slots[editing] : null

  return (
    <div className="page settings-page">
      <header className="topbar">
        <button type="button" className="icon-btn" onClick={() => back('unit')} aria-label="Back">
          <BackIcon />
        </button>
      </header>
      <h1 className="page-title">Settings</h1>

      <section className="panel">
        <h2 className="panel-title">The unit</h2>
        <p className="panel-sub">Match it to your furniture. Tap a cube to change what it holds.</p>
        <Stepper label="Across" value={map.cols} min={1} max={8} onChange={(v) => change((m) => (m.cols = v))} />
        <Stepper label="Down" value={map.rows} min={1} max={8} onChange={(v) => change((m) => (m.rows = v))} />
        <Stepper
          label="Records per cube"
          value={map.capacity}
          min={10}
          max={200}
          step={5}
          onChange={(v) => change((m) => (m.capacity = v))}
        />
        <UnitMap built={built} byId={store.byId} highlight={editing !== null ? [editing] : []} onCube={setEditing} />

        {slot && editing !== null && (
          <div className="slot-editor">
            <p className="panel-sub">
              Cube {editing + 1} holds{slot.type === 'flow' ? ' part of the A–Z run' : ''}:
            </p>
            <div className="chips">
              <button
                type="button"
                className={`chip ${slot.type === 'flow' ? 'on' : ''}`}
                onClick={() => change((m) => (m.slots[editing] = { type: 'flow' }))}
              >
                A–Z run
              </button>
              {snapshot.shelves
                .filter((s) => s.id !== map.flowShelf)
                .map((s) => {
                  const on = slot.type === 'shelves' && (slot.shelfIds || []).includes(s.id)
                  return (
                    <button
                      type="button"
                      key={s.id}
                      className={`chip ${on ? 'on' : ''}`}
                      onClick={() => toggleShelf(editing, s.id)}
                    >
                      {s.name}
                    </button>
                  )
                })}
            </div>
          </div>
        )}
        {homeless.length > 0 && (
          <p className="error-note">
            {homeless.map((h) => h.name).join(', ')} {homeless.length === 1 ? 'has' : 'have'} no cube — tap a
            cube to give {homeless.length === 1 ? 'it' : 'them'} one.
          </p>
        )}
        {newerSnapshot && (
          <p className="panel-sub">There's a newer snapshot since you changed this layout.</p>
        )}
        {store.local.map && (
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setMap(null)
              setEditing(null)
            }}
          >
            {newerSnapshot ? 'Use the snapshot’s layout' : 'Back to the original layout'}
          </button>
        )}
      </section>

      <section className="panel">
        <h2 className="panel-title">New records</h2>
        <p className="panel-sub">
          Bought something? Add it on Discogs, then check here — it's filed with the same rules as the rest.
          {store.local.lastCheck ? ` Last checked ${timeAgo(Date.parse(store.local.lastCheck))}.` : ''}
        </p>
        <button type="button" className="btn btn-secondary" disabled={Boolean(checking)} onClick={runCheck}>
          {checking
            ? `${checking.stage}${checking.total ? ` ${checking.done}/${checking.total}` : '…'}`
            : 'Check Discogs for new records'}
        </button>
        {checkError && <p className="error-note">{checkError}</p>}
        {store.local.fresh.length > 0 && (
          <ul className="fresh-list">
            {store.local.fresh.map((r) => (
              <li key={r.id}>
                <button type="button" className="row-button" onClick={() => go(`r/${r.id}`)}>
                  <span>{r.title}</span>
                  <span className="row-value">{r.artist}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="panel-foot">
          New sleeves are found by typing. The camera learns them at the next snapshot.
        </p>
      </section>

      <section className="panel">
        <h2 className="panel-title">This phone</h2>
        <p className="panel-sub">
          Snapshot of {snapshot.username}'s collection from {new Date(snapshot.exportedAt).toLocaleDateString()}.
          What's out, cube ticks and layout changes are saved on this device.
        </p>
        <button
          type="button"
          className="link-btn danger"
          onClick={() => {
            const saved = store.local
            update((l) => ({ ...l, out: {}, recent: [], sorted: {} }))
            toast('Cleared', { undo: () => update(() => saved) })
          }}
        >
          Clear what's out, recent and ticks
        </button>
      </section>
    </div>
  )
}

function Stepper({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div className="stepper-ctl">
        <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`Fewer ${label}`}>
          −
        </button>
        <output>{value}</output>
        <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`More ${label}`}>
          +
        </button>
      </div>
    </div>
  )
}

const flowCount = (m: ShelfMapConfig) =>
  m.slots.slice(0, m.cols * m.rows).filter((s) => s.type === 'flow').length

/**
 * Make the slot list match the number of cubes. New cubes join the end of the A–Z
 * run. Removing cubes takes them out of the run first, so the named shelves keep
 * their place; if a named-shelf cube has to go, its shelves move into the last one
 * left rather than vanishing.
 */
function fitSlots(m: ShelfMapConfig) {
  const n = m.cols * m.rows
  let slots = m.slots.slice()
  while (slots.length < n) {
    let lastFlow = -1
    slots.forEach((s, i) => s.type === 'flow' && (lastFlow = i))
    slots.splice(lastFlow + 1, 0, { type: 'flow' })
  }
  while (slots.length > n) {
    const flows = slots.map((s, i) => (s.type === 'flow' ? i : -1)).filter((i) => i >= 0)
    if (flows.length > 1) {
      slots.splice(flows[flows.length - 1], 1)
      continue
    }
    // Only one flow cube left: fold the last shelves cube into the one before it.
    const shelfSlots = slots.map((s, i) => (s.type === 'shelves' ? i : -1)).filter((i) => i >= 0)
    const last = shelfSlots[shelfSlots.length - 1]
    const prev = shelfSlots[shelfSlots.length - 2]
    if (prev === undefined) {
      slots = slots.slice(0, n)
      break
    }
    slots[prev] = {
      type: 'shelves',
      shelfIds: [...new Set([...(slots[prev].shelfIds || []), ...(slots[last].shelfIds || [])])],
    }
    slots.splice(last, 1)
  }
  m.slots = slots
}
