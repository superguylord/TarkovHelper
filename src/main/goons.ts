import type { GoonReport, GoonsState } from '@shared/types'
import { httpFetch } from './http'

// Где сейчас Кочевники (Отступники): доклады игроков с главной страницы tarkov.help.
// Отдельного API нет — данные лежат в странице в виде JSON внутри скрипта Next.js.
const PAGE = 'https://tarkov.help/ru'

interface RawReport {
  reporter: string
  name: string
  time: { hours: number | string; minutes: number | string }
}

/** Достаёт объект "goons": {...} из экранированного JSON в странице. */
function extractGoons(html: string): any | null {
  const at = html.indexOf('\\"goons\\":{\\"reports')
  if (at < 0) return null
  const chunk = html.slice(at, at + 40000).replace(/\\\\/g, '\\').replace(/\\"/g, '"')
  const start = chunk.indexOf('{')
  let depth = 0
  for (let i = start; i < chunk.length; i++) {
    if (chunk[i] === '{') depth++
    else if (chunk[i] === '}' && --depth === 0) return JSON.parse(chunk.slice(start, i + 1))
  }
  return null
}

const minutes = (t: RawReport['time']) => (Number(t.hours) || 0) * 60 + (Number(t.minutes) || 0)

/** Время «ЧЧ:ММ по Москве» -> отметка времени (последнее такое время, не в будущем). */
function moscowTime(hhmm: string, now: number): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm ?? '')
  if (!m) return null
  const msk = new Date(now + 3 * 3600_000) // Москва — UTC+3 без перехода на летнее время
  let t = Date.UTC(msk.getUTCFullYear(), msk.getUTCMonth(), msk.getUTCDate(), Number(m[1]), Number(m[2])) - 3 * 3600_000
  if (t > now + 60_000) t -= 86400_000
  return t
}

export async function fetchGoons(resolveMap: (key: string, name: string) => string | null): Promise<GoonsState> {
  const res = await httpFetch(PAGE, { headers: { 'User-Agent': 'Mozilla/5.0 TarkovHelper' } })
  if (!res.ok) throw new Error(`tarkov.help: HTTP ${res.status}`)
  const goons = extractGoons(await res.text())
  if (!goons) throw new Error('tarkov.help: блок с Кочевниками не найден')

  // страница отдаётся из кэша, и «N мин назад» в ней устаревает. Точное время последнего доклада
  // есть по Москве — от него восстанавливаем момент, когда страница считалась, и время остальных докладов
  const now = Date.now()
  const l = goons.last_report
  const lastAt = l ? (moscowTime(l.time_specific_moscow, now) ?? now - minutes(l.time_relative_past) * 60_000) : now
  const renderedAt = l ? lastAt + minutes(l.time_relative_past) * 60_000 : now

  const history: GoonReport[] = []
  for (const [key, list] of Object.entries<RawReport[]>(goons.reports ?? {})) {
    for (const r of list) {
      history.push({ map: resolveMap(key, r.name), mapName: r.name, reporter: r.reporter, at: renderedAt - minutes(r.time) * 60_000 })
    }
  }
  history.sort((a, b) => b.at - a.at)

  const last: GoonReport | null = l
    ? { map: resolveMap(l.location, l.name), mapName: l.name, reporter: l.reporter, at: lastAt }
    : (history[0] ?? null)
  return { last, history, fetchedAt: now, error: null }
}
