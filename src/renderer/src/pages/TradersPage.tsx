import { useEffect, useMemo, useState } from 'react'
import type { Item } from '@shared/types'
import type { AppState } from '../useAppState'
import { rub } from '../questLogic'

type Mode = 'sell' | 'buy'

const CURRENCY: Record<string, (n: number) => string> = {
  RUB: (n) => rub(n),
  USD: (n) => `$${Math.round(n).toLocaleString('ru-RU')}`,
  EUR: (n) => `€${Math.round(n).toLocaleString('ru-RU')}`
}
const money = (n: number, currency: string) => (CURRENCY[currency] ?? CURRENCY.RUB)(n)
const LEVELS = ['', 'I', 'II', 'III', 'IV']

/** Подробно по одному предмету: кто сколько даст и где купить. */
function ItemPrices({ item, onBack }: { item: Item; onBack: () => void }) {
  const slots = item.width * item.height
  const flea = item.avg24hPrice ?? item.lastLowPrice
  const bestSell = item.sellTo[0]?.priceRUB ?? 0
  return (
    <div className="page tp-item">
      <button className="btn" onClick={onBack}>
        ← К списку
      </button>
      <div className="tp-item-head">
        {item.iconLink && <img src={item.iconLink} alt="" />}
        <div>
          <div className="tp-item-name">{item.name}</div>
          <div className="muted">
            {item.shortName} · {item.width}×{item.height} ({slots} сл.)
          </div>
        </div>
      </div>

      <div className="tp-columns">
        <section className="tp-box">
          <div className="row-title">Продать торговцу</div>
          {item.sellTo.length === 0 ? (
            <p className="muted small">Торговцы этот предмет не покупают.</p>
          ) : (
            <table className="tp-table">
              <tbody>
                {item.sellTo.map((s) => (
                  <tr key={s.trader} className={s.priceRUB === bestSell ? 'best' : ''}>
                    <td>{s.trader}</td>
                    <td className="num">{money(s.price, s.currency)}</td>
                    <td className="num muted">{s.currency !== 'RUB' ? rub(s.priceRUB) : ''}</td>
                    <td className="num muted">{rub(s.priceRUB / slots)} / сл.</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="tp-flea">
            Для сравнения, барахолка: <b>{rub(flea)}</b>
            {flea != null && bestSell > 0 && (
              <span className={flea > bestSell ? 'up' : 'down'}>
                {flea > bestSell ? ` — на ${rub(flea - bestSell)} дороже, чем у торговца` : ' — торговец даёт больше'}
              </span>
            )}
          </div>
        </section>

        <section className="tp-box">
          <div className="row-title">Купить у торговца</div>
          {item.buyFrom.length === 0 ? (
            <p className="muted small">У торговцев не продаётся — только барахолка или бартер.</p>
          ) : (
            <table className="tp-table">
              <tbody>
                {item.buyFrom.map((b, i) => (
                  <tr key={b.trader + i} className={i === 0 ? 'best' : ''}>
                    <td>
                      {b.trader} <span className="lvl">{LEVELS[b.level] ?? b.level}</span>
                    </td>
                    <td className="num">{money(b.price, b.currency)}</td>
                    <td className="num muted">{b.currency !== 'RUB' ? rub(b.priceRUB) : ''}</td>
                    <td className="muted small">
                      {b.buyLimit ? `лимит ${b.buyLimit}` : ''}
                      {b.taskUnlock ? ` · после квеста «${b.taskUnlock}»` : ''}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {item.buyFrom.length > 0 && <p className="muted small">Римская цифра — нужный уровень лояльности торговца.</p>}
        </section>
      </div>
    </div>
  )
}

/** Торговцы: проверка цен — сколько дадут за предмет и где его купить. */
export function TradersPage({ s }: { s: AppState }) {
  const { data, live } = s
  const [query, setQuery] = useState('')
  const [found, setFound] = useState<Item[] | null>(null)
  const [mode, setMode] = useState<Mode>('sell')
  const [trader, setTrader] = useState<string | null>(null)
  const [selected, setSelected] = useState<Item | null>(null)

  useEffect(() => {
    if (query.trim().length < 2) return setFound(null)
    const t = setTimeout(() => window.api.searchItems(query).then(setFound), 200)
    return () => clearTimeout(t)
  }, [query, data])

  const traders = useMemo(
    () => (data?.traders ?? []).filter((t) => data!.items.some((i) => i.sellTo.some((x) => x.trader === t.name) || i.buyFrom.some((x) => x.trader === t.name))),
    [data]
  )

  // без поиска: ассортимент выбранного торговца или то, что ему выгоднее всего сдавать
  const list = useMemo(() => {
    if (!data) return []
    if (found) {
      return trader
        ? found.filter((i) => (mode === 'buy' ? i.buyFrom : i.sellTo).some((x) => x.trader === trader))
        : found
    }
    if (!trader) return []
    if (mode === 'buy') {
      return data.items
        .filter((i) => i.buyFrom.some((b) => b.trader === trader))
        .sort((a, b) => {
          const la = a.buyFrom.find((x) => x.trader === trader)!
          const lb = b.buyFrom.find((x) => x.trader === trader)!
          return la.level - lb.level || la.priceRUB - lb.priceRUB
        })
    }
    return data.items
      .filter((i) => i.sellTo[0]?.trader === trader)
      .sort((a, b) => b.sellTo[0].priceRUB - a.sellTo[0].priceRUB)
      .slice(0, 150)
  }, [data, found, trader, mode])

  if (!data) return <div className="empty">Данные ещё не загружены. {live?.dataStatus}</div>
  if (selected) return <ItemPrices item={selected} onBack={() => setSelected(null)} />

  const priceFor = (i: Item) => {
    if (mode === 'buy') {
      const offer = trader ? i.buyFrom.find((b) => b.trader === trader) : i.buyFrom[0]
      return offer
        ? { who: `${offer.trader} ${LEVELS[offer.level] ?? ''}`, value: money(offer.price, offer.currency) }
        : { who: 'не продаётся', value: '—' }
    }
    const s = trader ? i.sellTo.find((x) => x.trader === trader) : i.sellTo[0]
    return s ? { who: s.trader, value: rub(s.priceRUB) } : { who: 'не покупают', value: '—' }
  }

  return (
    <div className="page traders-page">
      <div className="eyebrow">Торговцы · проверка цен</div>
      <div className="toolbar">
        <input
          className="search wide"
          autoFocus
          placeholder="Название предмета, например «Видеокарта» или «Болты»"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="seg">
          <button className={mode === 'sell' ? 'active' : ''} onClick={() => setMode('sell')}>
            Продать
          </button>
          <button className={mode === 'buy' ? 'active' : ''} onClick={() => setMode('buy')}>
            Купить
          </button>
        </div>
      </div>
      <div className="tp-traders">
        <button className={!trader ? 'prio active' : 'prio'} onClick={() => setTrader(null)}>
          Все торговцы
        </button>
        {traders.map((t) => (
          <button key={t.id} className={trader === t.name ? 'prio active' : 'prio'} onClick={() => setTrader(t.name)}>
            {t.name}
          </button>
        ))}
      </div>

      {!found && !trader && (
        <p className="muted">
          Найдите предмет, чтобы увидеть, сколько за него дадут все торговцы и где его купить. Или выберите торговца:
          в режиме «Продать» — что ему выгоднее всего сдавать, в режиме «Купить» — его ассортимент с ценами и уровнями.
        </p>
      )}
      {list.length === 0 && (found || trader) && <div className="empty">Ничего не найдено.</div>}

      {list.length > 0 && (
        <div className="tp-list">
          <div className="tp-row tp-row-head">
            <span />
            <span>Предмет</span>
            <span>{mode === 'buy' ? 'Где купить' : 'Лучший торговец'}</span>
            <span className="num">{mode === 'buy' ? 'Цена' : 'Даст'}</span>
            <span className="num">Барахолка</span>
          </div>
          {list.map((i) => {
            const p = priceFor(i)
            return (
              <button key={i.id} className="tp-row" onClick={() => setSelected(i)}>
                {i.iconLink ? <img src={i.iconLink} alt="" loading="lazy" /> : <span />}
                <span className="tp-name">
                  {i.name}
                  <small>{i.shortName}</small>
                </span>
                <span className="muted">{p.who}</span>
                <span className="num">{p.value}</span>
                <span className="num muted">{rub(i.avg24hPrice ?? i.lastLowPrice)}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
