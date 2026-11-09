import type {
  BringItem,
  Extract,
  GameData,
  GameMode,
  HideoutLevel,
  HideoutStation,
  Item,
  MapInfo,
  MapLayer,
  MapPoint,
  Task,
  TraderInfo
} from '@shared/types'
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

// названия этажей в maps.json английские
const LAYER_NAMES: Dict = {
  '2nd Floor': '2 этаж',
  '3rd Floor': '3 этаж',
  '4th Floor': '4 этаж',
  '5th Floor': '5 этаж',
  Underground: 'Подземный уровень',
  Garage: 'Гараж',
  Tunnels: 'Тоннели',
  Bunkers: 'Бункеры',
  'Second Level': '2 уровень',
  Technical: 'Технический уровень',
  Infirmary: 'Медблок',
  Helipad: 'Вертолётная площадка',
  'Gym/Canteen': 'Спортзал / столовая',
  'Accommodation (lower)': 'Жилой блок (низ)',
  'Accommodation (mid)': 'Жилой блок (середина)',
  'Accommodation (upper)': 'Жилой блок (верх)',
  "Officers' Deck": 'Офицерская палуба',
  'Stairs (blocked)': 'Лестница (закрыта)',
  Bridge: 'Мостик',
  'Bridge Roof': 'Крыша мостика',
  'Control Room': 'Пункт управления',
  'Engine Room': 'Машинное отделение',
  'Engine Room (upper)': 'Машинное отделение (верх)',
  'Fuel Pumps (lower)': 'Топливные насосы (низ)',
  'Fuel Pumps': 'Топливные насосы',
  'Storage/Security': 'Склад / охрана'
}

function toLayer(l: any): MapLayer {
  return {
    name: LAYER_NAMES[l.name] ?? l.name,
    svgLayer: l.svgLayer,
    tilePath: l.tilePath,
    extents: (l.extents ?? []).map((e: any) => ({
      height: [Number(e.height?.[0] ?? -1000), Number(e.height?.[1] ?? 1000)] as [number, number],
      bounds: (e.bounds ?? []).map((b: any) => [b[0][0], b[0][1], b[1][0], b[1][1]] as [number, number, number, number])
    }))
  }
}

async function fetchMapsRaw(mode: GameMode): Promise<{ geo: any[]; data: any; ru: Dict }> {
  const [geo, dump] = await Promise.all([getJson(MAPS_JSON), getDump(mode, 'maps')])
  return { geo, ...dump }
}

function buildMaps(
  { geo, data, ru }: { geo: any[]; data: any; ru: Dict },
  itemName: (id: string) => string
): { maps: MapInfo[]; mapIdToName: Dict } {
  const all = Object.values<any>(data.maps)
  const mapIdToName: Dict = {}
  const mapTitle: Dict = {}
  for (const m of all) {
    mapIdToName[m.id] = geoName(m.normalizedName)
    mapTitle[m.id] = tr(ru, m.name)
  }

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
      position: e.position ?? null,
      note: e.transferItem
        ? e.transferItem.item === ROUBLES
          ? `Плата: ${e.transferItem.count.toLocaleString('ru-RU')} ₽`
          : `Нужен предмет: ${itemName(e.transferItem.item)}${e.transferItem.count > 1 ? ` ×${e.transferItem.count}` : ''}`
        : undefined
    }))
    // переходы на другие локации тоже выводят из рейда
    for (const t of main.transits ?? []) {
      extracts.push({
        name: tr(ru, t.description) || `Переход: ${mapTitle[t.map] ?? ''}`,
        faction: 'transit',
        position: t.position ?? null,
      })
    }
    maps.push({
      normalizedName: group.normalizedName,
      name: tr(ru, main.name),
      nameIds: variants.map((m) => String(m.nameId).toLowerCase()),
      svgPath: g.svgPath,
      svgLayer: g.svgLayer,
      layers: (g.layers ?? []).map(toLayer),
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

const ROUBLES = '5449016a4bdc2d6f028b456f'

const COMPARE: Dict = { '>=': 'не менее', '<=': 'не более', '>': 'более', '<': 'менее', '==': 'ровно' }

/** Подсказки к цели квеста из структурированных данных: что взять, куда идти, на что смотреть. */
function objectiveHints(o: any, ru: Dict, name: (id: string) => string): string[] {
  const h: string[] = []
  const ids = (arr: any[] | undefined): string[] =>
    (arr ?? []).flat().map((x: any) => (typeof x === 'string' ? x : x?.id)).filter(Boolean)
  const list = (arr: any[] | undefined) => {
    const all = ids(arr)
    const shown = all.slice(0, 4).map(name).join(', ')
    return all.length > 4 ? `${shown} и ещё ${all.length - 4}` : shown
  }
  const keys = (o.requiredKeys ?? []) as string[][]
  if (keys.length) h.push(`Нужен ключ: ${keys.map((alt) => alt.map(name).join(' или ')).join('; ')}`)

  switch (o.type) {
    case 'findItem':
    case 'giveItem':
      if (ids(o.items).length) h.push(`Предмет: ${list(o.items)}${o.count > 1 ? ` ×${o.count}` : ''}`)
      if (o.foundInRaid) h.push('Только найденные в рейде (FIR) — купленные не засчитаются')
      if (o.minDurability > 0 || (o.maxDurability ?? 100) < 100) h.push(`Прочность ${o.minDurability}–${o.maxDurability}%`)
      break
    case 'plantItem':
      h.push(`Взять с собой: ${list(o.items)}${o.count > 1 ? ` ×${o.count}` : ''}`)
      break
    case 'mark':
      if (o.markerItem) h.push(`Взять с собой: ${name(o.markerItem)}`)
      break
    case 'findQuestItem':
      if (o.questItem) h.push(`Подобрать «${name(o.questItem)}» и выйти с ним живым`)
      if ((o.possibleLocations ?? []).reduce((n: number, l: any) => n + (l.positions?.length ?? 0), 0) > 1) {
        h.push('Предмет появляется в одном из отмеченных мест — проверьте все')
      }
      break
    case 'plantQuestItem':
      if (o.questItem) h.push(`Заложить «${name(o.questItem)}»`)
      break
    case 'useItem':
      if (ids(o.useAny).length) h.push(`Использовать: ${list(o.useAny)}`)
      break
    case 'extract':
      h.push(o.exitName ? `Выйти через: ${tr(ru, o.exitName)}` : 'Выжить и выйти из рейда')
      break
    case 'buildWeapon':
      if (o.item) h.push(`Собрать: ${name(o.item)}`)
      break
    case 'shoot': {
      const targets = (o.targetNames ?? []).map((t: string) => (t === 'Any' ? 'любая' : tr(ru, t))).join(', ')
      if (targets) h.push(`Цель: ${targets}${o.count > 1 ? ` ×${o.count}` : ''}`)
      if (o.distance?.value > 0) h.push(`Дистанция ${COMPARE[o.distance.compareMethod] ?? ''} ${o.distance.value} м`)
      if (ids(o.usingWeapon).length) h.push(`Оружие: ${list(o.usingWeapon)}`)
      if (ids(o.usingWeaponMods).length) h.push(`Обвес: ${list(o.usingWeaponMods)}`)
      if ((o.bodyParts ?? []).length) h.push(`Попадание: ${o.bodyParts.map((b: string) => tr(ru, b)).join(', ')}`)
      if (ids(o.wearing).length) h.push(`Надеть: ${list(o.wearing)}`)
      if (ids(o.notWearing).length) h.push(`Нельзя надевать: ${list(o.notWearing)}`)
      if (o.timeFromHour || o.timeUntilHour) h.push(`Время в игре: с ${o.timeFromHour}:00 до ${o.timeUntilHour}:00`)
      break
    }
  }
  return h
}

/** Что нужно иметь при себе в рейде для цели: ключи, закладки, маркеры, используемые предметы. */
function objectiveBring(o: any, name: (id: string) => string): BringItem[] {
  const out: BringItem[] = []
  const alts = (ids: string[] | undefined) => (ids ?? []).map(name).join(' или ')
  for (const keys of (o.requiredKeys ?? []) as string[][]) {
    if (keys.length) out.push({ name: alts(keys), count: 1, kind: 'key' })
  }
  if (o.type === 'plantItem' && o.items?.length) out.push({ name: alts(o.items), count: o.count || 1, kind: 'plant' })
  if (o.type === 'mark' && o.markerItem) out.push({ name: name(o.markerItem), count: 1, kind: 'mark' })
  if (o.type === 'useItem' && o.useAny?.length) out.push({ name: alts(o.useAny), count: o.count || 1, kind: 'use' })
  if (o.type === 'plantQuestItem' && o.questItem) out.push({ name: name(o.questItem), count: 1, kind: 'questItem' })
  return out
}

function toTask(t: any, ru: Dict, traders: Dict, mapName: Dict, name: (id: string) => string): Task {
  return {
    id: t.id,
    name: tr(ru, t.name),
    trader: traders[t.trader] ?? '',
    map: t.map ? (mapName[t.map] ?? null) : null,
    minPlayerLevel: t.minPlayerLevel ?? 0,
    kappaRequired: !!t.kappaRequired,
    wikiLink: t.wikiLink ?? '',
    requires: (t.taskRequirements ?? []).map((r: any) => ({ taskId: r.task, status: r.status ?? [] })),
    neededKeys: (t.neededKeys ?? []).map((k: any) => ({ map: mapName[k.map] ?? null, keys: (k.keys ?? []).map(name) })),
    objectives: (t.objectives ?? []).map((o: any) => {
      const points: MapPoint[] = []
      for (const z of o.zones ?? []) {
        if (!z.position || !mapName[z.map]) continue
        const outline = (z.outline ?? []).map((p: any) => ({ x: p.x, z: p.z }))
        points.push({ map: mapName[z.map], ...z.position, ...(outline.length > 2 ? { outline } : {}) })
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
        points,
        hints: objectiveHints(o, ru, name),
        bring: objectiveBring(o, name)
      }
    })
  }
}

function toItem(i: any, ru: Dict, traders: Dict, usedIn: Map<string, string[]>, taskNames: Dict): Item {
  const sellTo = (i.sellToTrader ?? [])
    .map((s: any) => ({ trader: traders[s.trader] ?? '', price: s.price, currency: s.currency, priceRUB: s.priceRUB }))
    .sort((a: any, b: any) => b.priceRUB - a.priceRUB)
  const buyFrom = (i.buyFromTrader ?? [])
    .map((b: any) => ({
      trader: traders[b.trader] ?? '',
      price: b.price,
      currency: b.currency,
      priceRUB: b.priceRUB,
      level: b.minTraderLevel ?? 1,
      taskUnlock: b.taskUnlock ? (taskNames[b.taskUnlock] ?? null) : null,
      buyLimit: b.buyLimit || null
    }))
    .sort((a: any, b: any) => a.priceRUB - b.priceRUB)
  const best = sellTo[0]
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
    bestTrader: best ? { name: best.trader, price: best.priceRUB } : null,
    sellTo,
    buyFrom,
    usedInTasks: usedIn.get(i.id) ?? []
  }
}

/** Модули убежища с уровнями и требованиями. */
function buildHideout({ data, ru }: { data: any; ru: Dict }, traders: Dict, itemName: (id: string) => string): HideoutStation[] {
  const stations = Object.values<any>(data)
  const stationName: Dict = {}
  for (const s of stations) stationName[s.id] = tr(ru, s.name)
  return stations
    .map((s) => ({
      id: s.id,
      name: stationName[s.id],
      levels: (s.levels ?? [])
        .map((l: any) => ({
          level: l.level,
          constructionTime: l.constructionTime ?? 0,
          items: (l.itemRequirements ?? []).map((r: any) => ({
            itemId: r.item,
            name: itemName(r.item),
            count: r.count,
            fir: !!r.attributes?.foundInRaid
          })),
          stations: (l.stationLevelRequirements ?? []).map((r: any) => ({
            stationId: r.station,
            name: stationName[r.station] ?? r.station,
            level: r.level
          })),
          traders: (l.traderRequirements ?? []).map((r: any) => ({ name: traders[r.trader] ?? r.trader, level: r.value ?? r.level })),
          skills: (l.skillRequirements ?? []).map((r: any) => ({ name: tr(ru, r.skill), level: r.level }))
        }))
        .sort((a: HideoutLevel, b: HideoutLevel) => a.level - b.level)
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'))
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

// версия в имени: при смене формата данных старый кэш просто не читается
const cacheName = (mode: GameMode) => `gamedata-v${CACHE_VERSION}-${mode}.json`

const CACHE_VERSION = 6

export function loadCached(mode: GameMode): GameData | null {
  for (let v = CACHE_VERSION; v >= 2; v--) {
    const d = readJson<GameData | null>(`gamedata-v${v}-${mode}.json`, null)
    if (d && d.tasks) return normalize(d, v < CACHE_VERSION)
  }
  return null
}

/** Старый кэш без новых полей: дополняем пустыми, а fetchedAt = 0 — чтобы данные сразу обновились. */
function normalize(d: GameData, old: boolean): GameData {
  if (!old) return d
  return {
    ...d,
    fetchedAt: 0,
    traders: d.traders ?? [],
    hideout: d.hideout ?? [],
    maps: d.maps.map((m) => ({ ...m, layers: m.layers ?? [] })),
    items: d.items.map((i) => ({ ...i, sellTo: i.sellTo ?? [], buyFrom: i.buyFrom ?? [] })),
    tasks: d.tasks.map((t) => ({
      ...t,
      neededKeys: Array.isArray(t.neededKeys) && typeof t.neededKeys[0] !== 'string' ? t.neededKeys : [],
      objectives: t.objectives.map((o) => ({ ...o, hints: o.hints ?? [], bring: o.bring ?? [] }))
    }))
  }
}

/**
 * Загружает всё, что получится; чего не удалось получить — берём из прошлого кэша.
 * complete = false, если хоть что-то не загрузилось (тогда стоит повторить позже).
 */
export async function fetchGameData(
  mode: GameMode,
  prev: GameData | null
): Promise<{ data: GameData; complete: boolean }> {
  const [traders, maps, tasks, items, hideout] = await Promise.allSettled([
    getDump(mode, 'traders'),
    fetchMapsRaw(mode),
    getDump(mode, 'tasks'),
    getDump(mode, 'items'),
    getDump(mode, 'hideout')
  ])
  const results = [traders, maps, tasks, items, hideout]
  for (const r of results) if (r.status === 'rejected') console.warn(String(r.reason))
  if (results.every((r) => r.status === 'rejected')) throw (maps as PromiseRejectedResult).reason

  const same = prev?.gameMode === mode ? prev : null
  const traderNames: Dict = {}
  const traderList: TraderInfo[] = []
  if (traders.status === 'fulfilled') {
    for (const t of Object.values<any>(traders.value.data)) {
      traderNames[t.id] = tr(traders.value.ru, t.name)
      traderList.push({ id: t.id, name: traderNames[t.id], normalizedName: t.normalizedName, resetTime: t.resetTime ?? null })
    }
  }
  const tasksV = tasks.status === 'fulfilled' ? tasks.value : null
  const itemsV = items.status === 'fulfilled' ? items.value : null

  // русские названия предметов и квестовых предметов — для подсказок и условий выходов
  const names = new Map<string, string>()
  for (const i of same?.items ?? []) names.set(i.id, i.name)
  if (itemsV) for (const i of Object.values<any>(itemsV.data.items)) names.set(i.id, tr(itemsV.ru, i.name))
  if (tasksV) for (const q of Object.values<any>(tasksV.data.questItems ?? {})) names.set(q.id, tr(tasksV.ru, q.name))
  const itemName = (id: string) => names.get(id) ?? id

  const mapsV = maps.status === 'fulfilled' ? buildMaps(maps.value, itemName) : null
  const rawTasks = tasksV ? Object.values<any>(tasksV.data.tasks) : []
  const usedIn = itemsUsedInTasks(rawTasks)
  const taskNames: Dict = {}
  if (tasksV) for (const t of rawTasks) taskNames[t.id] = tr(tasksV.ru, t.name)
  // без торговцев и карт квесты получатся неполными — тогда оставляем прошлые
  const tradersOk = traders.status === 'fulfilled'
  const tasksOk = !!tasksV && tradersOk && !!mapsV
  const itemsOk = !!itemsV && tradersOk && !!tasksV

  const data: GameData = {
    fetchedAt: 0,
    gameMode: mode,
    traders: traderList.length ? traderList : (same?.traders ?? []),
    maps: mapsV ? mapsV.maps : (same?.maps ?? []),
    tasks: tasksOk
      ? rawTasks.map((t) => toTask(t, tasksV!.ru, traderNames, mapsV!.mapIdToName, itemName))
      : (same?.tasks ?? []),
    items: itemsOk
      ? Object.values<any>(itemsV!.data.items).map((i) => toItem(i, itemsV!.ru, traderNames, usedIn, taskNames))
      : (same?.items ?? []),
    hideout:
      hideout.status === 'fulfilled' && tradersOk
        ? buildHideout(hideout.value, traderNames, itemName)
        : (same?.hideout ?? [])
  }
  const complete = !!mapsV && tasksOk && itemsOk
  data.fetchedAt = complete ? Date.now() : (same?.fetchedAt ?? 0)
  writeJson(cacheName(mode), data)
  return { data, complete }
}
