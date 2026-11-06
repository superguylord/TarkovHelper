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

export interface MapInfo {
  normalizedName: string
  name: string
  nameIds: string[] // идентификаторы локации из логов игры (bigmap, factory4_day...)
  svgPath?: string
  svgLayer?: string // слой основного уровня внутри SVG
  hiddenSvgLayers: string[] // слои других этажей — скрываем, чтобы не накладывались
  tilePath?: string
  tileSize?: number
  minZoom?: number
  maxZoom?: number
  transform: number[]
  coordinateRotation: number
  bounds: number[][]
  extracts: Extract[]
}

export interface TaskObjective {
  id: string
  type: string
  description: string
  optional: boolean
  maps: string[]
  points: MapPoint[]
  hints: string[] // что взять с собой и на что обратить внимание
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
  neededKeys: string[] // ключи, которые понадобятся
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
  usedInTasks: string[]
}

export interface GameData {
  fetchedAt: number
  gameMode: GameMode
  maps: MapInfo[]
  tasks: Task[]
  items: Item[]
}

export type TaskStatus = 'active' | 'completed' | 'failed'

export interface Progress {
  playerLevel: number
  tasks: Record<string, TaskStatus>
  objectives: Record<string, boolean> // цели, отмеченные выполненными вручную
}

export interface Hotkeys {
  overlay: string // показать/скрыть оверлей
  minimap: string // мини-карта поверх игры
  price: string // цена предмета под курсором
}

export interface Settings {
  gamePath: string
  screenshotsPath: string
  gameMode: 'auto' | GameMode
  hotkeys: Hotkeys
  minimapOpacity: number
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

/** Раздел «Выполнение» из русской вики: абзацы и пункты списка простым текстом. */
export interface QuestGuide {
  url: string
  blocks: { kind: 'p' | 'li'; text: string }[]
}

export type OverlayMode = 'hidden' | 'minimap' | 'full'

export interface Api {
  getData(): Promise<GameData | null>
  refreshData(): Promise<void>
  getSettings(): Promise<Settings>
  setSettings(patch: Partial<Settings>): Promise<Settings>
  getProgress(): Promise<Progress>
  setTaskStatus(taskId: string, status: TaskStatus | null): Promise<Progress>
  setPlayerLevel(level: number): Promise<Progress>
  setObjectiveDone(objectiveId: string, done: boolean): Promise<Progress>
  getGuide(taskName: string): Promise<QuestGuide | null>
  importFromLogs(): Promise<number>
  getLive(): Promise<LiveState>
  setCurrentMap(map: string | null): Promise<void>
  checkPrice(): Promise<void>
  searchItems(query: string): Promise<Item[]>
  setOverlayMode(mode: OverlayMode): Promise<void>
  pickFolder(): Promise<string | null>
  on(channel: 'data' | 'live' | 'progress' | 'price' | 'overlay-mode' | 'settings', cb: (payload: any) => void): () => void
}
