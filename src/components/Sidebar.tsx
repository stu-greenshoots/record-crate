import { useState } from 'react'
import type { AppState } from '../types'

interface Props {
  state: AppState
  counts: Record<string, number>
  total: number
  active: string
  onSelect: (shelf: string) => void
  onDropRecord: (shelfId: string) => void
  onSync: () => void
  syncing: boolean
  onAddShelf: (name: string) => void
  onRenameShelf: (id: string, name: string) => void
  onDeleteShelf: (id: string) => void
  value: { total: number; priced: number; currency: string } | null
  valuing: boolean
  onValue: () => void
  onLogout: () => void
  open: boolean
}

function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n)
  } catch {
    return `${currency} ${Math.round(n)}`
  }
}

function ago(iso: string | null) {
  if (!iso) return 'never'
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.round(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.round(hrs / 24)}d ago`
}

export function Sidebar(props: Props) {
  const { state, counts, total, active, onSelect } = props
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  const enrich = state.enrich
  const artistsLeft = enrich.artists.total - enrich.artists.done
  const mastersLeft = (enrich.masters?.total ?? 0) - (enrich.masters?.done ?? 0)
  const releasesLeft = enrich.releases.total - enrich.releases.done
  const working = state.sync.running || enrich.running

  function shelfRow(id: string, name: string, count: number) {
    if (editing === id) {
      return (
        <input
          key={id}
          className="shelf-edit"
          autoFocus
          defaultValue={name}
          onBlur={(e) => {
            props.onRenameShelf(id, e.target.value)
            setEditing(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            if (e.key === 'Escape') setEditing(null)
          }}
        />
      )
    }
    return (
      <button
        key={id}
        className={`shelf-item ${active === id ? 'active' : ''} ${dropTarget === id ? 'drop' : ''}`}
        onClick={() => onSelect(id)}
        onDoubleClick={() => id !== 'all' && setEditing(id)}
        onDragOver={(e) => {
          if (id === 'all') return
          e.preventDefault()
          setDropTarget(id)
        }}
        onDragLeave={() => setDropTarget((t) => (t === id ? null : t))}
        onDrop={(e) => {
          e.preventDefault()
          setDropTarget(null)
          if (id !== 'all') props.onDropRecord(id)
        }}
        title={id === 'all' ? undefined : 'Double-click to rename · drag records here to re-shelve'}
      >
        <span className="shelf-dot" />
        <span className="shelf-name">{name}</span>
        <span className="shelf-count">{count}</span>
      </button>
    )
  }

  return (
    <aside className={`sidebar ${props.open ? 'open' : ''}`}>
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name">Record Crate</span>
      </div>

      <div className="sidebar-scroll">
        {shelfRow('all', 'Everything', total)}

        <div className="side-label">
          <span>Shelves</span>
          <button onClick={() => setAdding(true)} title="New shelf">
            +
          </button>
        </div>

        {state.shelves.map((s) => shelfRow(s.id, s.name, counts[s.id] || 0))}

        {adding && (
          <input
            className="shelf-edit"
            autoFocus
            placeholder="Shelf name…"
            onBlur={(e) => {
              if (e.target.value.trim()) props.onAddShelf(e.target.value.trim())
              setAdding(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setAdding(false)
            }}
          />
        )}

        {active !== 'all' && state.shelves.some((s) => s.id === active) && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ width: '100%', marginTop: 14, justifyContent: 'center' }}
            onClick={() => props.onDeleteShelf(active)}
          >
            Remove this shelf
          </button>
        )}
      </div>

      <div className="sidebar-foot">
        {props.value && props.value.priced > 0 ? (
          <div className="value-tile">
            <div className="k">Collection value</div>
            <div className="v">{money(props.value.total, props.value.currency)}</div>
            <div className="s">
              lowest listed across {props.value.priced} of {total}
              {props.valuing ? ' · still pricing…' : ''}
            </div>
          </div>
        ) : (
          <button
            className="btn btn-ghost btn-sm"
            style={{ justifyContent: 'center' }}
            onClick={props.onValue}
            disabled={props.valuing || !total}
          >
            {props.valuing ? 'Pricing collection…' : 'Estimate collection value'}
          </button>
        )}

        {working && (
          <div className="progress">
            <div className="progress-label">
              <span>
                {state.sync.running
                  ? `Syncing ${state.sync.fetched}/${state.sync.total || '…'}`
                  : releasesLeft > 0
                    ? `Fetching sleeves · ${releasesLeft} left`
                    : mastersLeft > 0
                      ? `Dating albums · ${mastersLeft} left`
                      : `Identifying artists · ${artistsLeft} left`}
              </span>
            </div>
            <div className="bar">
              <span
                style={{
                  width: state.sync.running
                    ? `${state.sync.total ? (state.sync.fetched / state.sync.total) * 100 : 5}%`
                    : `${enrich.releases.total ? (enrich.releases.done / enrich.releases.total) * 100 : 0}%`,
                }}
              />
            </div>
          </div>
        )}

        <div className="user-row">
          {state.user?.avatar ? (
            <img className="avatar" src={state.user.avatar} alt="" />
          ) : (
            <span className="avatar" />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="user-name">{state.user?.username}</div>
            <div className="user-sub">synced {ago(state.collection.syncedAt)}</div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            onClick={props.onSync}
            disabled={props.syncing}
            title="Pull the latest from Discogs"
          >
            {props.syncing ? <span className="spinner" /> : 'Sync'}
          </button>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          style={{ justifyContent: 'center' }}
          onClick={props.onLogout}
        >
          Disconnect
        </button>
      </div>
    </aside>
  )
}
