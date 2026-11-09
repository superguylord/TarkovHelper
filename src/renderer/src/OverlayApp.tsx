import { useEffect, useState } from 'react'
import { useAppState } from './useAppState'
import { Shell } from './MainApp'
import { PriceCard } from './components/PriceCard'

const PRICE_TOAST_MS = 8000

/** Прозрачное окно поверх игры: всплывающая цена и полный режим. */
export function OverlayApp() {
  const s = useAppState()
  const { overlayMode, price, data } = s
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
            <PriceCard item={price.item} data={data} progress={s.progress} />
          ) : (
            <div className="empty">Не удалось распознать предмет</div>
          )}
        </div>
      )}

      {/* оверлей не размонтируем, чтобы при повторном открытии остались раздел и план рейда */}
      <div className="overlay-full" style={{ display: overlayMode === 'full' ? undefined : 'none' }}>
        <div className="overlay-panel">
          <Shell s={s} overlay />
        </div>
      </div>
    </>
  )
}
