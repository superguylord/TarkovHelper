import { useState } from 'react'
import { useAppState, type AppState } from './useAppState'
import { MapPage } from './pages/MapPage'
import { QuestsPage } from './pages/QuestsPage'
import { PricesPage } from './pages/PricesPage'
import { SettingsPage } from './pages/SettingsPage'

export type Tab = 'map' | 'quests' | 'prices' | 'settings'
export const TABS: [Tab, string][] = [
  ['map', 'Карта'],
  ['quests', 'Квесты'],
  ['prices', 'Цены'],
  ['settings', 'Настройки']
]

export function TabContent({ tab, s }: { tab: Tab; s: AppState }) {
  if (tab === 'map') return <MapPage s={s} />
  if (tab === 'quests') return <QuestsPage s={s} />
  if (tab === 'prices') return <PricesPage s={s} />
  return <SettingsPage s={s} />
}

export function Logo() {
  return (
    <div className="logo">
      <div className="logo-mark">T</div>
      <div>
        <div className="logo-title">
          TARKOV <span>HELPER</span>
        </div>
        <div className="logo-sub">полевой компаньон</div>
      </div>
    </div>
  )
}

export function StatusChips({ s }: { s: AppState }) {
  const { live, data } = s
  const mapName = data?.maps.find((m) => m.normalizedName === live?.currentMap)?.name
  return (
    <div className="chips">
      <span className="chip">{mapName ?? 'Карта не определена'}</span>
      <span className={live?.inRaid ? 'chip chip-on' : 'chip'}>{live?.inRaid ? 'В рейде' : 'В меню'}</span>
      <span className="chip">{(data?.gameMode ?? live?.detectedMode) === 'pve' ? 'PvE' : 'PvP'}</span>
    </div>
  )
}

export function MainApp() {
  const s = useAppState()
  const [tab, setTab] = useState<Tab>('map')
  return (
    <div className="app">
      <header className="header">
        <Logo />
        <nav className="nav">
          {TABS.map(([t, label]) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {label}
            </button>
          ))}
        </nav>
        <StatusChips s={s} />
        <button className="btn btn-brass" onClick={() => window.api.setOverlayMode('full')}>
          Оверлей <kbd>{s.settings?.hotkeys.overlay}</kbd>
        </button>
      </header>
      <main className="content">
        <TabContent tab={tab} s={s} />
      </main>
    </div>
  )
}
