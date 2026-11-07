import { useState, type ReactNode } from 'react'
import { useAppState, type AppState } from './useAppState'
import type { RaidPlan } from './raidPlan'
import { BriefingPage } from './pages/BriefingPage'
import { MapPage } from './pages/MapPage'
import { QuestsPage } from './pages/QuestsPage'
import { PricesPage } from './pages/PricesPage'
import { TradersPage } from './pages/TradersPage'
import { SettingsPage } from './pages/SettingsPage'

export type Tab = 'briefing' | 'quests' | 'map' | 'prices' | 'traders' | 'settings'

/** Переходы между разделами и план рейда (живёт, пока открыто окно). */
export interface Nav {
  go(tab: Tab): void
  plan: RaidPlan | null
  setPlan(plan: RaidPlan | null): void
  mapRequest: { map: string; at: number } | null // какую локацию открыть на карте
  openMap(map: string): void
}

// иконки — простые контуры, чтобы меню читалось без картинок
const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
)

const SECTIONS: { title: string; items: [Tab, string, ReactNode][] }[] = [
  {
    title: 'Операции',
    items: [
      ['briefing', 'Брифинг', icon('M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z')],
      ['quests', 'Задания', icon('M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01')],
      ['map', 'Карты', icon('M9 4L3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14')]
    ]
  },
  {
    title: 'Экономика',
    items: [
      ['prices', 'Барахолка', icon('M12 3v18M17 7H9.5a3 3 0 0 0 0 6h5a3 3 0 0 1 0 6H6')],
      ['traders', 'Торговцы', icon('M4 9l1.5-5h13L20 9M4 9h16v11H4zM9 20v-6h6v6')]
    ]
  },
  {
    title: 'Система',
    items: [['settings', 'Настройки', icon('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12l2-1-2-4-2 1-2-1V5h-4v2l-2 1-2-1-2 4 2 1v0l-2 1 2 4 2-1 2 1v2h4v-2l2-1 2 1 2-4z')]]
  }
]

function TabContent({ tab, s, nav }: { tab: Tab; s: AppState; nav: Nav }) {
  if (tab === 'briefing') return <BriefingPage s={s} nav={nav} />
  if (tab === 'map') return <MapPage s={s} nav={nav} />
  if (tab === 'quests') return <QuestsPage s={s} />
  if (tab === 'prices') return <PricesPage s={s} />
  if (tab === 'traders') return <TradersPage s={s} />
  return <SettingsPage s={s} />
}

function Logo() {
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

function Status({ s }: { s: AppState }) {
  const { live, data } = s
  const mapName = data?.maps.find((m) => m.normalizedName === live?.currentMap)?.name
  return (
    <div className="side-status">
      <div className={live?.inRaid ? 'status-dot on' : 'status-dot'} />
      <div>
        <div className="status-main">{live?.inRaid ? `В рейде · ${mapName ?? '?'}` : 'В меню'}</div>
        <div className="status-sub">
          {(data?.gameMode ?? live?.detectedMode) === 'pve' ? 'PvE' : 'PvP'}
          {!live?.inRaid && mapName ? ` · последняя карта: ${mapName}` : ''}
        </div>
      </div>
    </div>
  )
}

/** Каркас приложения: меню слева и раздел справа. Один и тот же в окне и в оверлее. */
export function Shell({ s, overlay }: { s: AppState; overlay?: boolean }) {
  const [tab, setTab] = useState<Tab>('briefing')
  const [plan, setPlan] = useState<RaidPlan | null>(null)
  const [mapRequest, setMapRequest] = useState<Nav['mapRequest']>(null)
  const nav: Nav = {
    go: setTab,
    plan,
    setPlan,
    mapRequest,
    openMap(map) {
      setMapRequest({ map, at: Date.now() })
      setTab('map')
    }
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <Logo />
        {SECTIONS.map((sec) => (
          <div key={sec.title} className="side-section">
            <div className="side-title">{sec.title}</div>
            {sec.items.map(([t, label, ic]) => (
              <button key={t} className={tab === t ? 'side-link active' : 'side-link'} onClick={() => setTab(t)}>
                {ic}
                {label}
              </button>
            ))}
          </div>
        ))}
        <div className="side-bottom">
          <Status s={s} />
          {overlay ? (
            <button className="btn" onClick={() => window.api.setOverlayMode('hidden')}>
              Закрыть оверлей <kbd>Esc</kbd>
            </button>
          ) : (
            <button className="btn btn-brass" onClick={() => window.api.setOverlayMode('full')}>
              Оверлей <kbd>{s.settings?.hotkeys.overlay}</kbd>
            </button>
          )}
        </div>
      </aside>
      <main className="content">
        <TabContent tab={tab} s={s} nav={nav} />
      </main>
    </div>
  )
}

export function MainApp() {
  const s = useAppState()
  return <Shell s={s} />
}
