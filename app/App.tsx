import { Component, type ReactNode } from 'react'
import { load, useLoadError, useStore } from './store'
import { go, useRoute } from './route'
import { ScanView } from './components/ScanView'
import { TurntableView } from './components/TurntableView'
import { OutView } from './components/OutView'
import { CubeView, UnitView } from './components/UnitView'
import { SettingsView } from './components/SettingsView'
import { ShelfView } from './components/ShelfView'
import { ArtistView } from './components/ArtistView'
import { StatsView } from './components/StatsView'
import { Toaster } from './components/Toast'
import { CameraIcon, DiscIcon, ReturnIcon, StatsIcon, UnitIcon } from './components/Icons'
import { warmUp } from './recognise'
import { PlayerBar } from './components/PlayerBar'
import { PreviewView } from './components/PreviewView'

/** If a screen throws, offer a way back rather than a blank page. */
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="page empty-state">
        <p>Something went wrong.</p>
        <p className="empty-sub">{String(this.state.error.message || this.state.error)}</p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            location.hash = '#/'
            location.reload()
          }}
        >
          Start again
        </button>
      </div>
    )
  }
}

export default function App() {
  return (
    <Boundary>
      <Screens />
    </Boundary>
  )
}

function Screens() {
  const route = useRoute()
  const store = useStore()
  const loadError = useLoadError()

  if (loadError && !store) {
    return (
      <div className="page empty-state">
        <span className="empty-disc" aria-hidden />
        <p>Couldn't load the collection.</p>
        <p className="empty-sub">{loadError}. Check the connection and try again.</p>
        <button type="button" className="btn btn-secondary" onClick={() => load()}>
          Try again
        </button>
      </div>
    )
  }

  if (route.name === 'scan') {
    return (
      <>
        <ScanView />
        <Toaster />
      </>
    )
  }

  const tab =
    route.name === 'out'
      ? 'out'
      : route.name === 'stats'
        ? 'stats'
        : ['unit', 'cube', 'settings', 'shelf'].includes(route.name)
          ? 'unit'
          : 'deck'
  const onDeck = route.name === 'find' || route.name === 'record'
  const outCount = store?.out.length || 0

  return (
    <div className="shell">
      {/* One turntable for the home screen and every record, so moving along the shelf
          turns the ring rather than loading a new page. */}
      <main key={onDeck ? 'deck' : route.name + ('index' in route ? route.index : '') + ('id' in route ? route.id : '')} className="view">
        {onDeck && <TurntableView id={route.name === 'record' ? route.id : null} />}
        {route.name === 'out' && <OutView />}
        {route.name === 'unit' && <UnitView />}
        {route.name === 'cube' && <CubeView index={route.index} />}
        {route.name === 'settings' && <SettingsView />}
        {route.name === 'shelf' && <ShelfView id={route.id} />}
        {route.name === 'artist' && <ArtistView discogsId={route.id} />}
        {route.name === 'mb' && <ArtistView mbid={route.id} />}
        {route.name === 'stats' && <StatsView />}
        {route.name === 'preview' && <PreviewView id={route.id} />}
      </main>

      <PlayerBar />
      <nav className="tabbar" aria-label="Sections">
        <button type="button" className={tab === 'deck' ? 'on' : ''} onClick={() => go('', tab === 'deck')}>
          <DiscIcon />
          <span>Turntable</span>
        </button>
        <button type="button" onPointerDown={() => warmUp()} onClick={() => go('scan')}>
          <CameraIcon />
          <span>Scan</span>
        </button>
        <button type="button" className={tab === 'out' ? 'on' : ''} onClick={() => go('out', tab === 'out')}>
          <span className="tab-icon">
            <ReturnIcon />
            {outCount > 0 && <b className="tab-badge">{outCount}</b>}
          </span>
          <span>Put back</span>
        </button>
        <button type="button" className={tab === 'unit' ? 'on' : ''} onClick={() => go('unit', tab === 'unit')}>
          <UnitIcon />
          <span>Unit</span>
        </button>
        <button type="button" className={tab === 'stats' ? 'on' : ''} onClick={() => go('stats', tab === 'stats')}>
          <StatsIcon />
          <span>Stats</span>
        </button>
      </nav>
      <Toaster />
    </div>
  )
}
