import { useStore } from './store'
import { go, useRoute } from './route'
import { FindView } from './components/FindView'
import { ScanView } from './components/ScanView'
import { RecordView } from './components/RecordView'
import { OutView } from './components/OutView'
import { CubeView, UnitView } from './components/UnitView'
import { SettingsView } from './components/SettingsView'
import { Toaster } from './components/Toast'
import { ReturnIcon, SearchIcon, UnitIcon } from './components/Icons'

export default function App() {
  const route = useRoute()
  const store = useStore()

  if (route.name === 'scan') {
    return (
      <>
        <ScanView />
        <Toaster />
      </>
    )
  }

  const tab = route.name === 'out' ? 'out' : ['unit', 'cube', 'settings'].includes(route.name) ? 'unit' : 'find'
  const outCount = store?.out.length || 0

  return (
    <div className="shell">
      <main key={route.name + ('id' in route ? route.id : '') + ('index' in route ? route.index : '')} className="view">
        {route.name === 'find' && <FindView />}
        {route.name === 'record' && <RecordView id={route.id} />}
        {route.name === 'out' && <OutView />}
        {route.name === 'unit' && <UnitView />}
        {route.name === 'cube' && <CubeView index={route.index} />}
        {route.name === 'settings' && <SettingsView />}
      </main>

      <nav className="tabbar" aria-label="Sections">
        <button type="button" className={tab === 'find' ? 'on' : ''} onClick={() => go('', tab === 'find')}>
          <SearchIcon />
          <span>Find</span>
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
      </nav>
      <Toaster />
    </div>
  )
}
