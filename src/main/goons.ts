import type { GoonReport, GoonsState } from '@shared/types'
import { httpFetch } from './http'

// Где сейчас Кочевники (Отступники): доклады игроков с tarkov.help.
// Берём их из того же запроса, которым сайт обновляет свой виджет. Сама страница сайта отдаётся
// из кэша и может отставать на много часов, поэтому её не читаем.
const API = 'https://tarkov.help/api/ru/goons/reports?limit=20'

interface RawReport {
  reporter: string
  location: string // ключ карты на сайте: customs, woods...
  name: string // название карты по-русски
  created: number // сколько минут назад сделан доклад
}

export async function fetchGoons(resolveMap: (key: string, name: string) => string | null): Promise<GoonsState> {
  const res = await httpFetch(API, { headers: { 'User-Agent': 'Mozilla/5.0 TarkovHelper', Accept: 'application/json' } })
  if (!res.ok) throw new Error(`tarkov.help: HTTP ${res.status}`)
  const body = await res.json()
  const list: RawReport[] = Array.isArray(body?.data) ? body.data : []
  if (!list.length) throw new Error('tarkov.help: докладов о Кочевниках нет')

  const now = Date.now()
  const history: GoonReport[] = list
    .filter((r) => r && typeof r.created === 'number' && r.name)
    .map((r) => ({ map: resolveMap(r.location, r.name), mapName: r.name, reporter: r.reporter, at: now - r.created * 60_000 }))
    .sort((a, b) => b.at - a.at)
  return { last: history[0] ?? null, history, fetchedAt: now, error: null }
}
