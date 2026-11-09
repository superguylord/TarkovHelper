import type { GameData, Item, Progress } from '@shared/types'
import { hideoutNeeds } from '../hideoutLogic'
import { rub } from '../questLogic'

/** Карточка предмета: цены на барахолке и у торговца, нужен ли для квестов. */
export function PriceCard({ item, data, progress }: { item: Item; data: GameData; progress?: Progress }) {
  const slots = item.width * item.height
  const best = Math.max(item.avg24hPrice ?? 0, item.bestTrader?.price ?? 0)
  const tasks = item.usedInTasks
    .map((id) => data.tasks.find((t) => t.id === id)?.name)
    .filter(Boolean) as string[]
  const fleaBetter = (item.avg24hPrice ?? 0) > (item.bestTrader?.price ?? 0)
  // для убежища — только уровни, которые ещё не построены
  const hideout = progress ? hideoutNeeds(data, progress, 'all').find((n) => n.itemId === item.id) : undefined
  return (
    <div className="price-card">
      <div className="price-head">
        {item.iconLink && <img src={item.iconLink} alt="" />}
        <div>
          <div className="price-name">{item.name}</div>
          <div className="muted">
            {item.shortName} · {item.width}×{item.height}
          </div>
        </div>
      </div>
      <div className="price-grid">
        <div className={fleaBetter ? 'price-cell best' : 'price-cell'}>
          <span>Барахолка (ср. 24ч)</span>
          <b>{rub(item.avg24hPrice)}</b>
        </div>
        <div className="price-cell">
          <span>Последняя цена</span>
          <b>{rub(item.lastLowPrice)}</b>
        </div>
        <div className={!fleaBetter && item.bestTrader ? 'price-cell best' : 'price-cell'}>
          <span>{item.bestTrader ? `Торговец: ${item.bestTrader.name}` : 'Торговец'}</span>
          <b>{rub(item.bestTrader?.price)}</b>
        </div>
        <div className="price-cell">
          <span>За слот</span>
          <b>{rub(best / slots)}</b>
        </div>
      </div>
      {tasks.length > 0 && (
        <div className="price-tasks">
          <span className="tag tag-brass">Нужен для квестов</span> {tasks.join(', ')}
        </div>
      )}
      {hideout && (
        <div className="price-tasks">
          <span className="tag tag-green-strong">Нужен для убежища ×{hideout.count}</span>{' '}
          {hideout.uses.map((u) => `${u.station} ур. ${u.level}`).join(', ')}
        </div>
      )}
    </div>
  )
}
