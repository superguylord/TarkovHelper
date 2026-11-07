import type { Hotkeys, Settings } from '@shared/types'
import type { AppState } from '../useAppState'

const HOTKEY_LABELS: [keyof Hotkeys, string][] = [
  ['overlay', 'Оверлей (карта, квесты, цены)'],
  ['price', 'Цена предмета под курсором']
]

export function SettingsPage({ s }: { s: AppState }) {
  const { settings, live, data } = s
  if (!settings) return null
  const set = (patch: Partial<Settings>) => window.api.setSettings(patch)
  const pick = async (key: 'gamePath' | 'screenshotsPath') => {
    const dir = await window.api.pickFolder()
    if (dir) set({ [key]: dir })
  }

  return (
    <div className="page settings">
      <section className="panel">
        <div className="eyebrow">Игра</div>
        <label className="field">
          <span>Папка игры (там лежат логи)</span>
          <div className="row">
            <input value={settings.gamePath} onChange={(e) => set({ gamePath: e.target.value })} />
            <button className="btn" onClick={() => pick('gamePath')}>Выбрать…</button>
          </div>
        </label>
        <label className="field">
          <span>Папка скриншотов (по ним определяется позиция)</span>
          <div className="row">
            <input value={settings.screenshotsPath} onChange={(e) => set({ screenshotsPath: e.target.value })} />
            <button className="btn" onClick={() => pick('screenshotsPath')}>Выбрать…</button>
          </div>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.deleteScreenshots}
            onChange={(e) => set({ deleteScreenshots: e.target.checked })}
          />{' '}
          Убирать скриншоты из игры в Корзину после того, как позиция прочитана
        </label>
        <label className="field">
          <span>Режим игры (влияет на цены и квесты)</span>
          <select value={settings.gameMode} onChange={(e) => set({ gameMode: e.target.value as Settings['gameMode'] })}>
            <option value="auto">Автоматически по логам{live?.detectedMode ? ` (сейчас ${live.detectedMode === 'pve' ? 'PvE' : 'PvP'})` : ''}</option>
            <option value="regular">PvP</option>
            <option value="pve">PvE</option>
          </select>
        </label>
      </section>

      <section className="panel">
        <div className="eyebrow">Горячие клавиши</div>
        <p className="muted small">
          Формат Electron: <code>F8</code>, <code>Alt+M</code>, <code>Ctrl+Shift+P</code>. Клавиша перестаёт работать в игре, пока
          TarkovHelper запущен. Игра должна быть в режиме «Оконный без рамки», иначе оверлей не виден.
        </p>
        {HOTKEY_LABELS.map(([k, label]) => (
          <label key={k} className="field inline">
            <span>{label}</span>
            <input
              className="hotkey"
              defaultValue={settings.hotkeys[k]}
              onBlur={(e) => set({ hotkeys: { ...settings.hotkeys, [k]: e.target.value.trim() } })}
            />
          </label>
        ))}
      </section>

      <section className="panel">
        <div className="eyebrow">Состояние</div>
        <p className="small">Данные: {live?.dataStatus}</p>
        <p className="small">Логи: {live?.logStatus}</p>
        {data && (
          <p className="small muted">
            Квестов: {data.tasks.length}, предметов: {data.items.length}, карт: {data.maps.length}
          </p>
        )}
        <button className="btn" onClick={() => window.api.refreshData()}>Обновить данные сейчас</button>
      </section>
    </div>
  )
}
