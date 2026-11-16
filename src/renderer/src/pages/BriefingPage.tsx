import { useEffect, useMemo, useState } from 'react'
import type { GoonsState } from '@shared/types'
import { PROFILE_LABEL } from '@shared/types'

const GOONS = 'Кочевники'
const GOONS_REPORT_MS = 12 * 3600_000 // доклад старше 12 часов уже ничего не говорит о том, где они сейчас
import type { AppState } from '../useAppState'
import type { Nav } from '../MainApp'
import { questState } from '../questLogic'
import { FLEA_LEVEL, buildPlan, mapPriority, sellingTraders } from '../raidPlan'

// предметы, которые у игрока уже есть (отмечаются вручную в плане рейда)
function loadOwned(profile: string): string[] {
  try {
    return JSON.parse(localStorage.getItem(`ownedItems:${profile}`) ?? '[]')
  } catch {
    return []
  }
}

const KIND_LABEL = { key: 'Ключ', mark: 'Пометить', plant: 'Заложить', questItem: 'Квестовый предмет', use: 'Использовать' }

export function timeAgo(at: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - at) / 60000))
  if (min < 1) return 'только что'
  if (min < 60) return `${min} мин назад`
  const h = Math.floor(min / 60)
  return `${h} ч ${min % 60} мин назад`
}

function GoonsCard({ goons }: { goons: GoonsState | null }) {
  // перерисовываем раз в минуту, чтобы «N мин назад» не застывало
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const last = goons?.last
  // в истории оставляем по одному (последнему) докладу на карту
  const recent = (goons?.history ?? []).filter((r, i, all) => all.findIndex((x) => x.mapName === r.mapName) === i).slice(0, 4)
  return (
    <div className="stat-card">
      <div className="stat-label">Кочевники</div>
      {last ? (
        <>
          <div className="stat-big">{last.mapName.toUpperCase()}</div>
          <div className="stat-sub">
            Доклад {timeAgo(last.at)} · {last.reporter}
          </div>
          {recent.length > 1 && (
            <div className="goons-history">
              {recent.slice(1).map((r) => (
                <span key={r.mapName}>
                  {r.mapName} — {timeAgo(r.at)}
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <div className="stat-big">НЕТ ДАННЫХ</div>
      )}
      <div className="stat-foot">
        {goons?.error ? `Не обновилось: ${goons.error}` : 'tarkov.help · обновляется каждые 2 минуты'}
      </div>
    </div>
  )
}

export function BriefingPage({ s, nav }: { s: AppState; nav: Nav }) {
  const { data, progress, live, goons } = s
  const priority = useMemo(() => (data ? mapPriority(data, progress) : []), [data, progress])
  const [selected, setSelected] = useState<string | null>(null)
  const profile = live?.profile ?? 'pvp'
  const [owned, setOwned] = useState<string[]>(() => loadOwned(profile))
  useEffect(() => setOwned(loadOwned(profile)), [profile])
  const traders = useMemo(() => (data ? sellingTraders(data) : []), [data])

  // по умолчанию — карта, на которой игрок сейчас, иначе самая выгодная
  const mapKey = selected ?? nav.plan?.map ?? (live?.inRaid ? live.currentMap : null) ?? priority[0]?.map.normalizedName ?? null
  const map = data?.maps.find((m) => m.normalizedName === mapKey)

  if (!data || !map) return <div className="empty">Данные ещё не загружены. {live?.dataStatus}</div>

  const active = data.tasks.filter((t) => questState(t, progress) === 'active').length
  const kappa = data.tasks.filter((t) => t.kappaRequired)
  const kappaDone = kappa.filter((t) => progress.tasks[t.id] === 'completed').length
  const kappaActive = kappa.filter((t) => questState(t, progress) === 'active').length
  const kappaAvailable = kappa.filter((t) => questState(t, progress) === 'available').length
  const questsHere = priority.find((p) => p.map.normalizedName === map.normalizedName)?.quests ?? 0
  const profileName = PROFILE_LABEL[live?.profile ?? 'pvp']
  const today = new Date().toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })

  // Кочевники: по свежему докладу с tarkov.help — 100%, если их видели на этой карте, и 0%, если на другой
  const seen = goons?.last && Date.now() - goons.last.at < GOONS_REPORT_MS ? goons.last : null
  const bosses = (map.bosses ?? []).map((b) => {
    const where = b.zones.length ? `Где: ${b.zones.join(', ')}` : undefined
    if (b.name !== GOONS || !seen?.map) return { ...b, note: where }
    return seen.map === map.normalizedName
      ? { ...b, chance: 1, note: `Замечены здесь ${timeAgo(seen.at)} (tarkov.help)${where ? '. ' + where : ''}` }
      : { ...b, chance: 0, note: `Сейчас на другой локации: ${seen.mapName}, доклад ${timeAgo(seen.at)} (tarkov.help)` }
  })

  const makePlan = () => nav.setPlan(buildPlan(data, map, progress, new Set(owned)))
  const shownPlan = nav.plan && nav.plan.map === map.normalizedName ? nav.plan : null
  // «у меня есть»: предмет больше не мешает квесту — план пересобирается сразу
  const markOwned = (name: string) => {
    const next = [...new Set([...owned, name])]
    setOwned(next)
    try {
      localStorage.setItem(`ownedItems:${profile}`, JSON.stringify(next))
    } catch {
      // без сохранения отметка проживёт до закрытия окна
    }
    nav.setPlan(buildPlan(data, map, progress, new Set(next)))
  }
  const setTrader = async (name: string, level: number) => {
    const p = await window.api.setTraderLevel(name, level)
    if (shownPlan) nav.setPlan(buildPlan(data, map, p, new Set(owned)))
  }

  return (
    <div className="page briefing">
      <div className="briefing-head">
        <div>
          <div className="eyebrow">
            Оперативный штаб · {today} · {profileName}
          </div>
          <h1 className="briefing-title">Следующий рейд начинается здесь</h1>
        </div>
        <button className="btn btn-brass" onClick={() => nav.go('map')}>
          Открыть карту
        </button>
      </div>

      <div className="stats">
        <div className="stat-card">
          <div className="stat-label">Текущие задания</div>
          <div className="stat-num">{active}</div>
          <div className="stat-sub">взято и не выполнено</div>
          <button className="btn stat-btn" onClick={() => nav.go('quests')}>
            Задания
          </button>
        </div>
        <div className="stat-card">
          <div className="stat-label">Задания для Каппы</div>
          <div className="stat-num">
            {kappaDone} <span className="stat-of">/ {kappa.length}</span>
          </div>
          <div className="bar">
            <div style={{ width: `${kappa.length ? (kappaDone / kappa.length) * 100 : 0}%` }} />
          </div>
          <div className="stat-sub">
            выполнено {kappaDone} из {kappa.length} · взято {kappaActive} · можно взять {kappaAvailable}
          </div>
        </div>
        <GoonsCard goons={goons} />
      </div>

      <div className="panel-row">
        <div className="row-title">Приоритет карт</div>
        <div className="priority">
          {priority.map((p, i) => (
            <button
              key={p.map.normalizedName}
              className={
                (p.map.normalizedName === map.normalizedName ? 'prio active' : 'prio') + (p.quests ? '' : ' prio-empty')
              }
              onClick={() => setSelected(p.map.normalizedName)}
            >
              <span className="prio-idx">{String(i + 1).padStart(2, '0')}</span>
              <span className="prio-name">{p.map.name}</span>
              <span className="prio-count">{p.quests}</span>
            </button>
          ))}
        </div>
      </div>

      <section className="plan">
        <div className="plan-head">
          <div>
            <div className="eyebrow">План рейда · {profileName}</div>
            <div className="plan-map">{map.name.toUpperCase()}</div>
            <div className="muted">
              {questsHere ? `Квестов с целями на этой карте: ${questsHere}` : 'На этой карте нет целей по взятым квестам'}
            </div>
          </div>
          {bosses.length > 0 && (
            <div className="bosses">
              <div className="eyebrow">Боссы на локации</div>
              <div className="boss-list">
                {bosses.map((b) => (
                  <span key={b.name} className={b.chance === 0 ? 'boss boss-away' : 'boss'} title={b.note}>
                    {b.name} <b>{Math.round(b.chance * 100)}%</b>
                  </span>
                ))}
              </div>
            </div>
          )}
          <div className="plan-actions">
            <button className="btn btn-brass" onClick={makePlan} disabled={!questsHere}>
              {shownPlan ? 'Обновить план' : 'Создать план'}
            </button>
            {shownPlan && (
              <button className="btn" onClick={() => nav.openMap(map.normalizedName)}>
                Квесты на карте
              </button>
            )}
          </div>
        </div>

        <div className="my-traders">
          <span className="muted small" title="В логах игры нет вашего уровня и лояльности. Приложение само поднимает их до требований взятых и выполненных квестов; точные значения поправьте здесь.">
            Что могу купить ·
          </span>
          <label className="trader-lvl">
            мой уровень
            <input
              type="number"
              min={1}
              max={79}
              value={progress.playerLevel}
              onChange={async (e) => {
                const p = await window.api.setPlayerLevel(Math.max(1, Math.min(79, Number(e.target.value) || 1)))
                if (shownPlan) nav.setPlan(buildPlan(data, map, p, new Set(owned)))
              }}
            />
          </label>
          <span className="muted small">
            {progress.playerLevel >= FLEA_LEVEL ? 'барахолка открыта' : `барахолка с ${FLEA_LEVEL} уровня`} · лояльность:
          </span>
          {traders.map((t) => (
            <label key={t} className="trader-lvl">
              {t}
              <select value={progress.traders?.[t] ?? 1} onChange={(e) => setTrader(t, Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>

        {shownPlan && (
          <div className="plan-body">
            <div className="row-title">Взять с собой · {shownPlan.bring.length}</div>
            {shownPlan.bring.length === 0 ? (
              <p className="muted small">Для этих заданий ничего особенного брать не нужно.</p>
            ) : (
              <div className="bring">
                {shownPlan.bring.map((b) => (
                  <div key={b.kind + b.name} className="bring-item">
                    <div className="bring-name">
                      {b.name}
                      {b.count > 1 && <span className="bring-count"> ×{b.count}</span>}
                    </div>
                    <div className="bring-meta">
                      {KIND_LABEL[b.kind]} · {b.purposes.join(', ')}
                    </div>
                    {b.source && <div className="bring-source">{b.source}</div>}
                  </div>
                ))}
              </div>
            )}
            {shownPlan.blocked.length > 0 && (
              <div className="blocked">
                <div className="row-title">Пока не выполнить · {shownPlan.blocked.length}</div>
                <p className="muted small">
                  Для этих заданий нужен предмет, который вы сейчас не можете купить. В план они не входят. Если предмет
                  уже лежит в схроне, нажмите «У меня есть».
                </p>
                {shownPlan.blocked.map((q) => (
                  <div key={q.quest} className="blocked-quest">
                    <div className="bring-name">{q.quest}</div>
                    {q.items.map((it) => (
                      <div key={it.name} className="blocked-item">
                        <span>
                          {it.name} — <span className="muted">{it.reason}</span>
                        </span>
                        <button className="btn btn-small" onClick={() => markOwned(it.name)}>
                          У меня есть
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            )}
            <p className="muted small">
              Только то, что нужно для заданий: ключи, закладки, маркеры и используемые предметы. Предметы «найти и
              вынести» сюда не входят. Квесты: {shownPlan.quests.join(', ') || '—'}.
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
