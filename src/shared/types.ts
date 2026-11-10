// Типы, общие для main-процесса и интерфейса.

export type GameMode = 'regular' | 'pve'

export interface Point3 {
  x: number
  y: number
  z: number
}

export interface MapPoint extends Point3 {
  map: string // normalizedName карты
  outline?: { x: number; z: number }[] // контур зоны, если он известен
}

export interface Extract {
  name: string
  faction: string // pmc | scav | shared | transit
  position: Point3 | null
  note?: string // условие выхода: оплата, предмет, переход на другую карту
}

export interface MapLabel {
  x: number
  z: number
  text: string
  size?: number // относительный размер шрифта, 100 — обычный (у мелких подписей 60–90)
  rotation?: number // поворот в градусах (названия улиц)
}

export interface MapInfo {
  normalizedName: string
  name: string
  nameIds: string[] // идентификаторы локации из логов игры (bigmap, factory4_day...)
  svgPath?: string
  svgLayer?: string // слой основного уровня внутри SVG
  layers: MapLayer[] // этажи и подземные уровни
  labels: MapLabel[] // подписи районов и зданий
  tilePath?: string
  tileSize?: number
  minZoom?: number
  maxZoom?: number
  transform: number[]
  coordinateRotation: number
  bounds: number[][]
  svgBounds?: number[][] // у некоторых карт (Резерв) SVG привязан к своему прямоугольнику
  extracts: Extract[]
}

/** Этаж карты: свой слой в SVG и/или свои тайлы, плюс зоны, где он «включается» по высоте. */
export interface MapLayer {
  name: string
  svgLayer?: string
  tilePath?: string
  // по высоте y и зонам зданий (прямоугольники [x1, z1, x2, z2]) определяем, на каком этаже точка;
  // пустой список зон — этаж занимает всю карту
  extents: { height: [number, number]; areas: MapArea[] }[]
}

export interface MapArea {
  name: string // здание, по-русски, если известно
  rect: [number, number, number, number]
}

export interface TaskObjective {
  id: string
  type: string
  description: string
  optional: boolean
  maps: string[]
  points: MapPoint[]
  hints: string[] // что взять с собой и на что обратить внимание
  bring: BringItem[] // что нужно иметь при себе в рейде для этой цели
}

/** Предмет, который нужно взять в рейд: ключ, закладка, маркер и т.п. */
export interface BringItem {
  name: string // несколько подходящих предметов — через «или»
  count: number
  kind: 'key' | 'plant' | 'mark' | 'use' | 'questItem'
}

export interface Task {
  id: string
  name: string
  trader: string
  map: string | null
  minPlayerLevel: number
  kappaRequired: boolean
  wikiLink: string
  requires: { taskId: string; status: string[] }[]
  neededKeys: { map: string | null; keys: string[] }[] // ключи, которые понадобятся, по картам
  objectives: TaskObjective[]
}

export interface Item {
  id: string
  name: string
  shortName: string
  avg24hPrice: number | null
  lastLowPrice: number | null
  basePrice: number
  width: number
  height: number
  iconLink: string
  bestTrader: { name: string; price: number } | null
  sellTo: TraderPrice[] // сколько дают торговцы, от большего к меньшему
  buyFrom: TraderOffer[] // где купить у торговцев, от дешёвого к дорогому
  usedInTasks: string[]
}

export interface TraderPrice {
  trader: string
  price: number // в валюте торговца
  currency: string // RUB | USD | EUR
  priceRUB: number
}

export interface TraderOffer extends TraderPrice {
  level: number // нужный уровень лояльности
  taskUnlock: string | null // квест, который открывает товар
  buyLimit: number | null
}

export interface TraderInfo {
  id: string
  name: string
  normalizedName: string
  resetTime: string | null // когда обновится ассортимент (ISO)
}

export interface HideoutLevel {
  level: number
  constructionTime: number // секунды
  items: { itemId: string; name: string; count: number; fir: boolean }[]
  stations: { stationId: string; name: string; level: number }[]
  traders: { name: string; level: number }[]
  skills: { name: string; level: number }[]
}

export interface HideoutStation {
  id: string
  name: string
  levels: HideoutLevel[]
}

export interface GameData {
  fetchedAt: number
  outdated?: boolean // кэш прошлой версии приложения — обновить при первой возможности
  gameMode: GameMode
  traders: TraderInfo[]
  maps: MapInfo[]
  tasks: Task[]
  items: Item[]
  hideout: HideoutStation[]
}

export type TaskStatus = 'active' | 'completed' | 'failed'

export interface Progress {
  playerLevel: number
  tasks: Record<string, TaskStatus>
  objectives: Record<string, boolean> // цели, отмеченные выполненными вручную
  hideout: Record<string, number> // построенный уровень модуля убежища
}

export interface Hotkeys {
  overlay: string // показать/скрыть оверлей
  price: string // цена предмета под курсором
}

export type MapStyle = 'classic' | 'scheme' | 'khaki' | 'night' | 'detailed'

export interface Settings {
  mapStyle: MapStyle
  gamePath: string
  screenshotsPath: string
  gameMode: 'auto' | GameMode
  hotkeys: Hotkeys
  deleteScreenshots: boolean // удалять скриншоты после чтения позиции
}

export interface PlayerPosition extends Point3 {
  map: string | null
  yaw: number // градусы, 0 = север игры (+z)
  at: number
}

export interface PriceResult {
  at: number
  text: string // что распознал OCR
  item: Item | null
  candidates: Item[]
}

export interface LiveState {
  currentMap: string | null
  inRaid: boolean
  detectedMode: GameMode | null
  position: PlayerPosition | null
  logStatus: string
  dataStatus: string
}

/** Гайд по квесту с tarkov.help: HTML страницы прохождения (текст и скриншоты мест). */
export interface QuestGuide {
  url: string
  html: string
}

/** Доклад о Кочевниках (Отступники: Big Pipe, Birdeye, Knight) с tarkov.help. */
export interface GoonReport {
  map: string | null // normalizedName карты в приложении
  mapName: string
  reporter: string
  at: number // примерное время доклада, мс
}

export interface GoonsState {
  last: GoonReport | null
  history: GoonReport[] // все доклады за последние часы, новые первыми
  fetchedAt: number
  error: string | null
}

/** Состояние автообновления. */
export interface UpdateState {
  status: 'dev' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error'
  current: string // установленная версия
  version?: string // новая версия
  percent?: number
  error?: string
}

export type OverlayMode = 'hidden' | 'full'

export interface Api {
  getData(): Promise<GameData | null>
  refreshData(): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getProgress(): Promise<Progress>
  setTaskStatus(taskId: string, status: TaskStatus | null): Promise<Progress>
  setPlayerLevel(level: number): Promise<Progress>
  setObjectiveDone(objectiveId: string, done: boolean): Promise<Progress>
  setHideoutLevel(stationId: string, level: number): Promise<Progress>
  getGuide(taskName: string): Promise<QuestGuide | null>
  getGoons(): Promise<GoonsState>
  getUpdate(): Promise<UpdateState>
  checkUpdate(): Promise<void>
  installUpdate(): Promise<void>
  importFromLogs(): Promise<number>
  getLive(): Promise<LiveState>
  setCurrentMap(map: string | null): Promise<void>
  checkPrice(): Promise<void>
  searchItems(query: string): Promise<Item[]>
  setOverlayMode(mode: OverlayMode): Promise<void>
  pickFolder(): Promise<string | null>
  on(
    channel: 'data' | 'live' | 'progress' | 'price' | 'overlay-mode' | 'settings' | 'goons' | 'update',
    cb: (payload: any) => void
  ): () => void
}
