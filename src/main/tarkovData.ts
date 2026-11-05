import type { GameData, GameMode, Item, MapInfo, MapPoint, Task } from '@shared/types'
import { readJson, writeJson } from './store'

// Данные берём с tarkov.dev: GraphQL API (квесты, предметы, цены, выходы)
// и maps.json из их репозитория (геометрия карт для отрисовки).
const API = 'https://api.tarkov.dev/graphql'
const MAPS_JSON = 'https://raw.githubusercontent.com/the-hideout/tarkov-dev/main/src/data/maps.json'

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  })
  const json = await res.json()
  if (!res.ok || json.errors?.length) {
    throw new Error(`tarkov.dev: ${JSON.stringify(json.errors ?? res.status).slice(0, 300)}`)
  }
  return json.data as T
}

const zone = `map { normalizedName } position { x y z }`

const TASKS_QUERY = (mode: GameMode) => `{
  tasks(lang: ru, gameMode: ${mode}) {
    id name minPlayerLevel kappaRequired wikiLink
    trader { name }
    map { normalizedName }
    taskRequirements { task { id } status }
    objectives {
      id type description optional maps { normalizedName }
      ... on TaskObjectiveBasic { zones { ${zone} } }
      ... on TaskObjectiveMark { zones { ${zone} } }
      ... on TaskObjectiveItem { zones { ${zone} } }
      ... on TaskObjectiveQuestItem { possibleLocations { map { normalizedName } positions { x y z } } }
      ... on TaskObjectiveUseItem { zones { ${zone} } }
      ... on TaskObjectiveShoot { zones { ${zone} } }
    }
  }
}`

const ITEMS_QUERY = (mode: GameMode) => `{
  items(lang: ru, gameMode: ${mode}) {
    id name shortName avg24hPrice lastLowPrice basePrice width height iconLink
    sellFor { vendor { normalizedName name } priceRUB }
    usedInTasks { id }
  }
}`

const MAPS_QUERY = (mode: GameMode) => `{
  maps(lang: ru, gameMode: ${mode}) {
    normalizedName name nameId
    extracts { name faction position { x y z } }
  }
}`

function toTask(t: any): Task {
  return {
    id: t.id,
    name: t.name,
    trader: t.trader?.name ?? '',
    map: t.map?.normalizedName ?? null,
    minPlayerLevel: t.minPlayerLevel ?? 0,
    kappaRequired: !!t.kappaRequired,
    wikiLink: t.wikiLink ?? '',
    requires: (t.taskRequirements ?? [])
      .filter((r: any) => r.task)
      .map((r: any) => ({ taskId: r.task.id, status: r.status ?? [] })),
    objectives: (t.objectives ?? []).map((o: any) => {
      const points: MapPoint[] = []
      for (const z of o.zones ?? []) {
        if (z.position && z.map) points.push({ map: z.map.normalizedName, ...z.position })
      }
      for (const loc of o.possibleLocations ?? []) {
        for (const p of loc.positions ?? []) points.push({ map: loc.map.normalizedName, ...p })
      }
      return {
        id: o.id,
        type: o.type,
        description: o.description,
        optional: !!o.optional,
        maps: (o.maps ?? []).map((m: any) => m.normalizedName),
        points
      }
    })
  }
}

function toItem(i: any): Item {
  // барахолка (flea-market) не торговец — для «лучшего торговца» её исключаем
  const traders = (i.sellFor ?? []).filter((s: any) => s.vendor?.normalizedName !== 'flea-market')
  const best = traders.sort((a: any, b: any) => b.priceRUB - a.priceRUB)[0]
  return {
    id: i.id,
    name: i.name,
    shortName: i.shortName,
    avg24hPrice: i.avg24hPrice || null,
    lastLowPrice: i.lastLowPrice || null,
    basePrice: i.basePrice ?? 0,
    width: i.width ?? 1,
    height: i.height ?? 1,
    iconLink: i.iconLink ?? '',
    bestTrader: best ? { name: best.vendor.name, price: best.priceRUB } : null,
    usedInTasks: (i.usedInTasks ?? []).map((t: any) => t.id)
  }
}

// Запасной вариант, если API недоступен: названия и идентификаторы локаций из логов.
const FALLBACK_MAPS: Record<string, { name: string; nameIds: string[] }> = {
  customs: { name: 'Таможня', nameIds: ['bigmap'] },
  factory: { name: 'Завод', nameIds: ['factory4_day', 'factory4_night'] },
  interchange: { name: 'Развязка', nameIds: ['interchange'] },
  woods: { name: 'Лес', nameIds: ['woods'] },
  shoreline: { name: 'Берег', nameIds: ['shoreline'] },
  reserve: { name: 'Резерв', nameIds: ['rezervbase'] },
  lighthouse: { name: 'Маяк', nameIds: ['lighthouse'] },
  'streets-of-tarkov': { name: 'Улицы Таркова', nameIds: ['tarkovstreets'] },
  'the-lab': { name: 'Лаборатория', nameIds: ['laboratory'] },
  'ground-zero': { name: 'Эпицентр', nameIds: ['sandbox', 'sandbox_high'] },
  'the-labyrinth': { name: 'Лабиринт', nameIds: ['labyrinth'] }
}

async function fetchMaps(mode: GameMode): Promise<MapInfo[]> {
  const [geo, api] = await Promise.all([
    fetch(MAPS_JSON).then((r) => r.json()),
    gql<{ maps: any[] }>(MAPS_QUERY(mode)).catch((e) => {
      console.warn('Карты из API недоступны, использую запасные названия:', e.message)
      return null
    })
  ])
  const result: MapInfo[] = []
  for (const group of geo as any[]) {
    // у каждой карты может быть несколько проекций; берём интерактивную
    const m = group.maps?.find((x: any) => x.projection === 'interactive')
    if (!m) continue
    const apiMaps = api?.maps.filter((a) => a.normalizedName === group.normalizedName) ?? []
    const fallback = FALLBACK_MAPS[group.normalizedName]
    if (!apiMaps.length && !fallback) continue
    result.push({
      normalizedName: group.normalizedName,
      name: apiMaps[0]?.name ?? fallback.name,
      nameIds: apiMaps.length ? apiMaps.map((a) => String(a.nameId).toLowerCase()) : fallback.nameIds,
      svgPath: m.svgPath,
      svgLayer: m.svgLayer,
      hiddenSvgLayers: (m.layers ?? []).map((l: any) => l.svgLayer).filter(Boolean),
      tilePath: m.tilePath,
      tileSize: m.tileSize,
      minZoom: m.minZoom,
      maxZoom: m.maxZoom,
      transform: m.transform ?? [1, 0, 1, 0],
      coordinateRotation: m.coordinateRotation ?? 0,
      bounds: m.bounds ?? [],
      extracts: apiMaps[0]?.extracts ?? []
    })
  }
  return result
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
  const [maps, tasks, items] = await Promise.allSettled([
    fetchMaps(mode),
    gql<{ tasks: any[] }>(TASKS_QUERY(mode)),
    gql<{ items: any[] }>(ITEMS_QUERY(mode))
  ])
  for (const r of [maps, tasks, items]) if (r.status === 'rejected') console.warn(String(r.reason))
  if (maps.status === 'rejected' && tasks.status === 'rejected' && items.status === 'rejected') {
    throw maps.reason
  }
  const same = prev?.gameMode === mode ? prev : null
  const complete = [maps, tasks, items].every((r) => r.status === 'fulfilled')
  const data: GameData = {
    fetchedAt: complete ? Date.now() : (same?.fetchedAt ?? 0),
    gameMode: mode,
    maps: maps.status === 'fulfilled' ? maps.value : (same?.maps ?? []),
    tasks: tasks.status === 'fulfilled' ? tasks.value.tasks.map(toTask) : (same?.tasks ?? []),
    items: items.status === 'fulfilled' ? items.value.items.map(toItem) : (same?.items ?? [])
  }
  writeJson(cacheName(mode), data)
  return { data, complete }
}
