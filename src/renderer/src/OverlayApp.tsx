import { useEffect, useState } from 'react'
import { useAppState } from './useAppState'
import { Logo, StatusChips, TABS, TabContent, type Tab } from './MainApp'
import { PriceCard } from './components/PriceCard'

const PRICE_TOAST_MS = 8000

/** Прозрачное окно поверх игры: всплывающая цена и полный режим. */
export function OverlayApp() {
  const s = useAppState()
  const { overlayMode, price, data } = s
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

  const showPrice = price && now - price.at < PRICE_TOAST_MS && overlayMode !== 'full'

  return (
    <>
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
