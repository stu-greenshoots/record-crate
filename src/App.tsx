import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from './api'
import type { AppState, RecordSummary } from './types'
import { Login } from './components/Login'
import { Sidebar } from './components/Sidebar'
import { Grid } from './components/Grid'
import { Crate } from './components/Crate'
import { Detail } from './components/Detail'
import { FilingCabinet } from './components/FilingCabinet'
import { Unit } from './components/Unit'
import { FileIt } from './components/FileIt'

type View = 'grid' | 'crate' | 'unit' | 'filing'

const VIEW_LABELS: [View, string][] = [
  ['grid', 'Grid'],
  ['crate', 'Crate'],
  ['unit', 'Shelf'],
  ['filing', 'Filing'],
]

export default function App() {
  const [state, setState] = useState<AppState | null>(null)
  const [records, setRecords] = useState<RecordSummary[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [shelf, setShelf] = useState('all')
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState('smart')
  const [view, setView] = useState<View>('grid')
  const [openId, setOpenId] = useState<number | null>(null)
  const [crateIndex, setCrateIndex] = useState(0)
  const [toast, setToast] = useState<{ msg: string; error?: boolean } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [value, setValue] = useState<{ total: number; priced: number; currency: string } | null>(null)
  const [valuing, setValuing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [filing, setFiling] = useState(false)
  const dragged = useRef<RecordSummary | null>(null)

  const notice = new URLSearchParams(location.search).get('auth')

  const flash = useCallback((msg: string, error = false) => {
    setToast({ msg, error })
    setTimeout(() => setToast(null), 3200)
  }, [])

  const loadRecords = useCallback(
    async (mode = sortMode) => {
      const res = await api.records(mode)
      setRecords(res.records)
      setCounts(res.counts)
    },
    [sortMode],
  )

  const loadState = useCallback(async () => {
    const s = await api.state()
    setState(s)
    return s
  }, [])

  useEffect(() => {
    loadState()
      .then((s) => {
        if (!s.authed) return
        setSortMode(s.settings.sortMode || 'smart')
        setView((s.settings.view as View) || 'grid')
        return api.records(s.settings.sortMode || 'smart').then((res) => {
          setRecords(res.records)
          setCounts(res.counts)
          // A signed-in account with nothing stored locally needs a first pull.
          if (!res.records.length && !s.collection.count) return handleSync()
        })
      })
      // Without this an early failure looks identical to an empty collection.
      .catch((err) => flash(`Could not load the collection: ${(err as Error).message}`, true))
    // Strip the ?auth= marker once we've read it.
    if (notice) history.replaceState({}, '', location.pathname)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // While the background crawl is running, refresh so artwork and filing settle in.
  useEffect(() => {
    if (!state?.authed) return
    const busy = state.sync.running || state.enrich.running || state.enrich.market.running
    if (!busy) return
    const t = setInterval(async () => {
      const s = await loadState()
      if (!s.sync.running && !s.enrich.running) loadRecords()
      if (s.enrich.market.running || valuing) api.value().then(setValue)
      if (!s.enrich.market.running) setValuing(false)
    }, 3000)
    return () => clearInterval(t)
  }, [state, loadState, loadRecords, valuing])

  // Periodically pull fresh artwork in while the first crawl fills the shelves.
  useEffect(() => {
    if (!state?.enrich.running) return
    const t = setInterval(() => loadRecords(), 8000)
    return () => clearInterval(t)
  }, [state?.enrich.running, loadRecords])

  async function handleSync() {
    setSyncing(true)
    try {
      const res = await api.sync()
      await loadState()
      await loadRecords()
      flash(res.added ? `Synced — ${res.added} new record${res.added === 1 ? '' : 's'}` : 'Collection up to date')
    } catch (err) {
      flash((err as Error).message, true)
    } finally {
      setSyncing(false)
    }
  }

  const shelfRecords = useMemo(
    () => (shelf === 'all' ? records : records.filter((r) => r.shelf === shelf)),
    [records, shelf],
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return shelfRecords
    return shelfRecords.filter((r) =>
      [r.title, r.artist, r.sortName, r.label, r.catno, ...r.genres, ...r.styles, String(r.year ?? '')]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [shelfRecords, query])

  useEffect(() => {
    setCrateIndex(0)
  }, [shelf, sortMode, query])

  async function changeSort(mode: string) {
    setSortMode(mode)
    await loadRecords(mode)
    api.settings({ sortMode: mode })
  }

  function changeView(v: View) {
    setView(v)
    api.settings({ view: v })
  }

  async function handleReorder(ordered: RecordSummary[]) {
    if (shelf === 'all') {
      flash('Pick a shelf before setting your own order', true)
      return
    }
    // Optimistic: show the new order immediately, persist behind it.
    const byId = new Map(ordered.map((r, i) => [r.instanceId, i]))
    setRecords((prev) =>
      [...prev].sort((a, b) => {
        const ai = byId.get(a.instanceId)
        const bi = byId.get(b.instanceId)
        if (ai == null || bi == null) return 0
        return ai - bi
      }),
    )
    setSortMode('manual')
    try {
      await api.setOrder(shelf, ordered.map((r) => r.instanceId))
      await loadRecords('manual')
      flash('Order saved')
    } catch (err) {
      flash((err as Error).message, true)
    }
  }

  async function handleDropOnShelf(shelfId: string) {
    const rec = dragged.current
    dragged.current = null
    if (!rec || rec.shelf === shelfId) return
    try {
      await api.setShelf(rec.instanceId, shelfId)
      await loadRecords()
      const name = state?.shelves.find((s) => s.id === shelfId)?.name ?? 'shelf'
      flash(`Moved to ${name}`)
    } catch (err) {
      flash((err as Error).message, true)
    }
  }

  async function handleShelfChange(rec: RecordSummary, shelfId: string) {
    await api.setShelf(rec.instanceId, shelfId)
    await loadRecords()
  }

  async function handleSortName(artistKey: string, sortName: string | null) {
    await api.setSortName(artistKey, sortName)
    await loadRecords()
    flash(sortName ? `Filed under “${sortName}”` : 'Reverted to the automatic filing')
  }

  async function startValuation() {
    setValuing(true)
    await api.startValuation()
    await loadState()
    flash('Pricing the collection — this runs in the background')
  }

  useEffect(() => {
    if (state?.authed && state.collection.count) api.value().then(setValue).catch(() => {})
  }, [state?.authed, state?.collection.count])

  if (!state) return <div className="login" />
  if (!state.authed) return <Login notice={notice} />

  const activeShelfName =
    shelf === 'all' ? 'Everything' : (state.shelves.find((s) => s.id === shelf)?.name ?? 'Shelf')

  // The unit shows the whole collection, so stepping through records there isn't
  // bounded by the shelf filter the other views use.
  const openList = view === 'unit' ? records : visible
  const openIdx = openId == null ? -1 : openList.findIndex((r) => r.instanceId === openId)
  const openRecord = openIdx >= 0 ? openList[openIdx] : null

  return (
    <div className="app">
      <div className={`scrim ${menuOpen ? 'on' : ''}`} onClick={() => setMenuOpen(false)} />
      <Sidebar
        state={state}
        counts={counts}
        total={records.length}
        active={shelf}
        open={menuOpen}
        onSelect={(s) => {
          setShelf(s)
          setMenuOpen(false)
        }}
        onDropRecord={handleDropOnShelf}
        onSync={handleSync}
        syncing={syncing || state.sync.running}
        onAddShelf={async (name) => {
          await api.addShelf(name)
          await loadState()
        }}
        onRenameShelf={async (id, name) => {
          await api.renameShelf(id, name)
          await loadState()
        }}
        onDeleteShelf={async (id) => {
          const fallback = state.shelves.find((s) => s.id !== id)
          if (!fallback) return
          const n = counts[id] || 0
          if (n && !confirm(`Move ${n} record${n === 1 ? '' : 's'} to ${fallback.name} and remove this shelf?`))
            return
          await api.deleteShelf(id, fallback.id)
          setShelf('all')
          await loadState()
          await loadRecords()
        }}
        value={value}
        valuing={valuing || state.enrich.market.running}
        onValue={startValuation}
        onLogout={async () => {
          await api.logout()
          location.href = '/'
        }}
      />

      <main className="main">
        <div className="topbar">
          <button
            className="menu-btn"
            onClick={() => setMenuOpen((v) => !v)}
            aria-label="Shelves"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 4h12M2 8h12M2 12h12"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
          </button>
          <div className="title-block">
            <h2>
              {view === 'filing' ? 'Filing cabinet' : view === 'unit' ? 'The unit' : activeShelfName}
            </h2>
            <div className="sub">
              {view === 'filing'
                ? 'How every artist is filed'
                : view === 'unit'
                  ? `${records.length} records across the cubes${query ? ` · highlighting “${query}”` : ''}`
                  : `${visible.length} record${visible.length === 1 ? '' : 's'}${
                      query ? ` matching “${query}”` : ''
                    }`}
            </div>
          </div>

          <div className="spacer" />

          {view !== 'filing' && (
            <>
              <div className="search">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                  <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
                <input
                  placeholder="Search the shelves…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="select">
                <select value={sortMode} onChange={(e) => changeSort(e.target.value)}>
                  {state.sortModes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <button
            className="btn btn-sm file-btn"
            onClick={() => setFiling(true)}
            title="Photograph a record and find where it goes"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path
                d="M2 5.5A1.5 1.5 0 013.5 4h1L5.5 2.5h5L11.5 4h1A1.5 1.5 0 0114 5.5v7A1.5 1.5 0 0112.5 14h-9A1.5 1.5 0 012 12.5v-7z"
                stroke="currentColor"
                strokeWidth="1.4"
              />
              <circle cx="8" cy="9" r="2.5" stroke="currentColor" strokeWidth="1.4" />
            </svg>
            <span className="file-btn-text">File a record</span>
          </button>

          <div className="segmented">
            {VIEW_LABELS.map(([id, label]) => (
              <button key={id} className={view === id ? 'on' : ''} onClick={() => changeView(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="content">
          {view === 'filing' ? (
            <FilingCabinet onChanged={() => loadRecords()} />
          ) : view === 'unit' ? (
            <Unit
              records={records}
              shelves={state.shelves}
              query={query}
              onOpen={(r) => setOpenId(r.instanceId)}
              onChanged={() => loadState()}
            />
          ) : visible.length === 0 ? (
            <div className="empty">
              <div>
                <h3>{query ? 'Nothing matches that' : 'This shelf is empty'}</h3>
                <p>
                  {query
                    ? 'Try a different artist, label or catalogue number.'
                    : 'Drag records here from another shelf, or open a record and pick this shelf.'}
                </p>
                {!records.length && (
                  <button className="btn btn-primary" onClick={handleSync} disabled={syncing}>
                    {syncing ? 'Syncing…' : 'Pull my collection'}
                  </button>
                )}
              </div>
            </div>
          ) : view === 'grid' ? (
            <Grid
              records={visible}
              sortMode={sortMode}
              currency={state.currency}
              onOpen={(r) => setOpenId(r.instanceId)}
              onReorder={handleReorder}
              onDragStateChange={(r) => (dragged.current = r)}
            />
          ) : (
            <Crate
              records={visible}
              index={Math.min(crateIndex, visible.length - 1)}
              onIndex={setCrateIndex}
              onOpen={(r) => setOpenId(r.instanceId)}
              sortMode={sortMode}
            />
          )}
        </div>
      </main>

      {openRecord && (
        <Detail
          record={openRecord}
          shelves={state.shelves}
          currency={state.currency}
          hasPrev={openIdx > 0}
          hasNext={openIdx >= 0 && openIdx < openList.length - 1}
          onClose={() => setOpenId(null)}
          onPrev={() => openIdx > 0 && setOpenId(openList[openIdx - 1].instanceId)}
          onNext={() =>
            openIdx >= 0 &&
            openIdx < openList.length - 1 &&
            setOpenId(openList[openIdx + 1].instanceId)
          }
          onShelf={(shelfId) => handleShelfChange(openRecord, shelfId)}
          onSortName={handleSortName}
        />
      )}

      {filing && (
        <FileIt
          records={records}
          onClose={() => setFiling(false)}
          onOpenRecord={(r) => {
            setFiling(false)
            setOpenId(r.instanceId)
          }}
        />
      )}

      {toast && <div className={`toast ${toast.error ? 'error' : ''}`}>{toast.msg}</div>}
    </div>
  )
}
