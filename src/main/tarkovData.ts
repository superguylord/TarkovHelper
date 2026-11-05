import type { Extract, GameData, GameMode, Item, MapInfo, MapPoint, Task } from '@shared/types'
import { readJson, writeJson } from './store'

// Данные берём с tarkov.dev: статические выгрузки json.tarkov.dev (их же использует сайт;
// GraphQL API бывает недоступен) и maps.json из их репозитория (геометрия карт).
// В выгрузках названия — это ключи перевода ("<id> Name"), русский текст лежит в файлах *_ru.
const JSON_BASE = 'https://json.tarkov.dev'
const MAPS_JSON = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'

// Варианты локаций, у которых нет своей геометрии, рисуем на основной карте
const GEO_ALIAS: Record<string, string> = {
  'night-factory': 'factory',
  'infected-factory': 'factory',
  'ground-zero-21': 'ground-zero',
  'ground-zero-tutorial': 'ground-zero',
  'the-lab-dark': 'the-lab',
  'infected-lab': 'the-lab'
}
const geoName = (normalizedName: string) => GEO_ALIAS[normalizedName] ?? normalizedName

type Dict = Record<string, string>

async function getJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res.json()
}

/** Выгрузка и её русский перевод. */
async function getDump(mode: GameMode, name: string): Promise<{ data: any; ru: Dict }> {
  const [dump, ru] = await Promise.all([
    getJson(`${JSON_BASE}/${mode}/${name}`),
    getJson(`${JSON_BASE}/${mode}/${name}_ru`)
  ])
  return { data: dump.data, ru: ru.data ?? ru }
}

const tr = (ru: Dict, key: string | undefined) => (key ? (ru[key] ?? key) : '')

async function fetchMaps(mode: GameMode): Promise<{ maps: MapInfo[]; mapIdToName: Dict }> {
  const [geo, { data, ru }] = await Promise.all([getJson(MAPS_JSON), getDump(mode, 'maps')])
  const all = Object.values<any>(data.maps)
  const mapIdToName: Dict = {}
  for (const m of all) mapIdToName[m.id] = geoName(m.normalizedName)

  const maps: MapInfo[] = []
  for (const group of geo as any[]) {
    // у каждой карты может быть несколько проекций; берём интерактивную
    const g = group.maps?.find((x: any) => x.projection === 'interactive')
    if (!g) continue
    const variants = all.filter((m) => geoName(m.normalizedName) === group.normalizedName)
    const main = variants.find((m) => m.normalizedName === group.normalizedName) ?? variants[0]
    if (!main) continue
    const extracts: Extract[] = (main.extracts ?? []).map((e: any) => ({
      name: tr(ru, e.name),
      faction: e.faction,
      position: e.position ?? null
    }))
    maps.push({
      normalizedName: group.normalizedName,
      name: tr(ru, main.name),
      nameIds: variants.map((m) => String(m.nameId).toLowerCase()),
      svgPath: g.svgPath,
      svgLayer: g.svgLayer,
      hiddenSvgLayers: (g.layers ?? []).map((l: any) => l.svgLayer).filter(Boolean),
      tilePath: g.tilePath,
      tileSize: g.tileSize,
      minZoom: g.minZoom,
      maxZoom: g.maxZoom,
      transform: g.transform ?? [1, 0, 1, 0],
      coordinateRotation: g.coordinateRotation ?? 0,
      bounds: g.bounds ?? [],
      extracts
    })
  }
  return { maps, mapIdToName }
}

function toTask(t: any, ru: Dict, traders: Dict, mapName: Dict): Task {
  return {
    id: t.id,
    name: tr(ru, t.name),
    trader: traders[t.trader] ?? '',
    map: t.map ? (mapName[t.map] ?? null) : null,
    minPlayerLevel: t.minPlayerLevel ?? 0,
    kappaRequired: !!t.kappaRequired,
    wikiLink: t.wikiLink ?? '',
    requires: (t.taskRequirements ?? []).map((r: any) => ({ taskId: r.task, status: r.status ?? [] })),
    objectives: (t.objectives ?? []).map((o: any) => {
      const points: MapPoint[] = []
      for (const z of o.zones ?? []) {
        if (z.position && mapName[z.map]) points.push({ map: mapName[z.map], ...z.position })
      }
      for (const loc of o.possibleLocations ?? []) {
        if (!mapName[loc.map]) continue
        for (const p of loc.positions ?? []) points.push({ map: mapName[loc.map], ...p })
      }
      return {
        id: o.id,
        type: o.type,
        description: tr(ru, o.description),
        optional: !!o.optional,
        maps: (o.maps ?? []).map((id: string) => mapName[id]).filter(Boolean),
        points
      }
    })
  }
}

function toItem(i: any, ru: Dict, traders: Dict, usedIn: Map<string, string[]>): Item {
  const best = [...(i.sellToTrader ?? [])].sort((a: any, b: any) => b.priceRUB - a.priceRUB)[0]
  return {
    id: i.id,
    name: tr(ru, i.name),
    shortName: tr(ru, i.shortName),
    avg24hPrice: i.avg24hPrice || null,
    lastLowPrice: i.lastLowPrice || null,
    basePrice: i.basePrice ?? 0,
    width: i.width ?? 1,
    height: i.height ?? 1,
    iconLink: i.iconLink ?? '',
    bestTrader: best ? { name: traders[best.trader] ?? '', price: best.priceRUB } : null,
    usedInTasks: usedIn.get(i.id) ?? []
  }
}

/** Какие квесты требуют предмет. Объективы вида «любой из 50 предметов» пропускаем — это шум. */
function itemsUsedInTasks(tasks: any[]): Map<string, string[]> {
  const used = new Map<string, string[]>()
  for (const t of tasks) {
    for (const o of t.objectives ?? []) {
      const ids: string[] = o.items ?? []
      if (!ids.length || ids.length > 5) continue
      for (const id of ids) {
        const list = used.get(id) ?? []
        if (!list.includes(t.id)) list.push(t.id)
        used.set(id, list)
      }
    }
  }
  return used
}

const cacheName = (mode: GameMode) => `gamedata-${mode}.json`

export function loadCached(mode: GameMode): GameData | null {
  const d = readJson<GameData | null>(cacheName(mode), null)
  return d && d.tasks ? d : null
}

/**
 * Загружает всё, что получится; чего не удалось получить — берём из прошлого кэша.
 * complete = false, если хоть что-то не загрузилось (тогда стоит повторить позже).
 */
export async function fetchGameData(
  mode: GameMode,
  prev: GameData | null
): Promise<{ data: GameData; complete: boolean }> {
  const [traders, maps, tasks, items] = await Promise.allSettled([
    getDump(mode, 'traders'),
    fetchMaps(mode),
    getDump(mode, 'tasks'),
    getDump(mode, 'items')
  ])
  const results = [traders, maps, tasks, items]
  for (const r of results) if (r.status === 'rejected') console.warn(String(r.reason))
  if (results.every((r) => r.status === 'rejected')) throw (maps as PromiseRejectedResult).reason

  const same = prev?.gameMode === mode ? prev : null
  const traderNames: Dict = {}
  if (traders.status === 'fulfilled') {
    for (const t of Object.values<any>(traders.value.data)) traderNames[t.id] = tr(traders.value.ru, t.name)
  }
  const mapsV = maps.status === 'fulfilled' ? maps.value : null
  const tasksV = tasks.status === 'fulfilled' ? tasks.value : null
  const itemsV = items.status === 'fulfilled' ? items.value : null
  const rawTasks = tasksV ? Object.values<any>(tasksV.data.tasks) : []
  const usedIn = itemsUsedInTasks(rawTasks)
  // без торговцев и карт квесты получатся неполными — тогда оставляем прошлые
  const tradersOk = traders.status === 'fulfilled'
  const tasksOk = !!tasksV && tradersOk && !!mapsV
  const itemsOk = !!itemsV && tradersOk && !!tasksV

  const data: GameData = {
    fetchedAt: 0,
    gameMode: mode,
    maps: mapsV ? mapsV.maps : (same?.maps ?? []),
    tasks: tasksOk
      ? rawTasks.map((t) => toTask(t, tasksV!.ru, traderNames, mapsV!.mapIdToName))
      : (same?.tasks ?? []),
    items: itemsOk
      ? Object.values<any>(itemsV!.data.items).map((i) => toItem(i, itemsV!.ru, traderNames, usedIn))
      : (same?.items ?? [])
  }
  const complete = !!mapsV && tasksOk && itemsOk
  data.fetchedAt = complete ? Date.now() : (same?.fetchedAt ?? 0)
  writeJson(cacheName(mode), data)
  return { data, complete }
}
