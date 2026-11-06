import { useEffect, useMemo, useState } from 'react'
import { useAppState } from './useAppState'
import { Logo, StatusChips, TABS, TabContent, type Tab } from './MainApp'
import { MapView } from './components/MapView'
import { PriceCard } from './components/PriceCard'
import { buildMarkers } from './mapMarkers'
import { loadFaction } from './pages/MapPage'

const PRICE_TOAST_MS = 8000

/** Прозрачное окно поверх игры: всплывающая цена, мини-карта и полный режим. */
export function OverlayApp() {
  const s = useAppState()
  const { overlayMode, price, data, live, progress, settings } = s
  const [tab, setTab] = useState<Tab>('map')
  const [now, setNow] = useState(Date.now())

  // скрываем карточку цены через несколько секунд
  useEffect(() => {
    if (!price) return
    setNow(Date.now())
    const t = setTimeout(() => setNow(Date.now()), PRICE_TOAST_MS)
    return () => clearTimeout(t)
  }, [price])

  useEffect(() => {
    if (overlayMode !== 'full') return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && window.api.setOverlayMode('hidden')
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [overlayMode])

  const map = data?.maps.find((m) => m.normalizedName === live?.currentMap)
  const markers = useMemo(
    () => (data && map ? buildMarkers(data, map, progress, {
            quests: true,
            available: false,
            extracts: true,
            faction: loadFaction(),
            selectedTask: null
          }) : []),
    [data, map, progress]
  )
  const showPrice = price && now - price.at < PRICE_TOAST_MS && overlayMode !== 'full'

  return (
    <>
      {overlayMode === 'minimap' && (
        <div className="minimap" style={{ opacity: settings?.minimapOpacity ?? 0.85 }}>
          {map ? (
            <MapView map={map} markers={markers} position={live?.position ?? null} compact />
          ) : (
            <div className="empty">Карта определится при загрузке в рейд</div>
          )}
        </div>
      )}

      {showPrice && (
        <div className="price-toast">
          {price.item && data ? (
            <PriceCard item={price.item} data={data} />
          ) : (
            <div className="empty">Не удалось распознать предмет</div>
          )}
        </div>
      )}

      {overlayMode === 'full' && (
        <div className="overlay-full">
          <div className="overlay-panel">
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
              <button className="btn" onClick={() => window.api.setOverlayMode('hidden')}>
                Закрыть <kbd>Esc</kbd>
              </button>
            </header>
            <main className="content">
              <TabContent tab={tab} s={s} />
            </main>
          </div>
        </div>
      )}
    </>
  )
}
