import { useEffect, useState } from 'react'
import type { Item } from '@shared/types'
import type { AppState } from '../useAppState'
import { PriceCard } from '../components/PriceCard'

export function PricesPage({ s }: { s: AppState }) {
  const { data, price, settings } = s
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Item[]>([])

  useEffect(() => {
    if (query.trim().length < 2) return setFound([])
    const t = setTimeout(() => window.api.searchItems(query).then(setFound), 200)
    return () => clearTimeout(t)
  }, [query, data])

  if (!data) return <div className="empty">Цены ещё не загружены.</div>

  return (
    <div className="page prices">
      <section>
        <div className="eyebrow">Поиск предмета</div>
        <input className="search wide" autoFocus placeholder="Название, например «Видеокарта» или «GPU»" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="cards">
          {found.map((it) => (
            <PriceCard key={it.id} item={it} data={data} />
          ))}
        </div>
      </section>
      <section>
        <div className="eyebrow">Последняя проверка в игре</div>
        <p className="muted small">
          Наведите курсор на предмет в игре и нажмите <kbd>{settings?.hotkeys.price}</kbd> — карточка появится поверх игры и здесь.
        </p>
        {price ? (
          <>
            {price.item ? <PriceCard item={price.item} data={data} /> : <div className="empty">Предмет не распознан.</div>}
            <p className="muted small">Распознано: «{price.text.replace(/\s+/g, ' ').slice(0, 120)}»</p>
            {price.candidates.length > 1 && (
              <p className="muted small">Другие варианты: {price.candidates.slice(1).map((c) => c.name).join(', ')}</p>
            )}
          </>
        ) : (
          <div className="empty">Пока ничего не проверяли.</div>
        )}
      </section>
    </div>
  )
}
