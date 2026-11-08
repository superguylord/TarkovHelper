import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

// Где установлена игра: лаунчер BSG, Steam или одна из типичных папок.
// Папка считается подходящей, если в ней есть EscapeFromTarkov.exe или папка Logs.

const isGameDir = (dir: string) =>
  existsSync(join(dir, 'EscapeFromTarkov.exe')) || existsSync(join(dir, 'Logs'))

function regValue(key: string, name: string): string | null {
  try {
    const out = execSync(`reg query "${key}" /v ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    return new RegExp(`${name}\\s+REG_\\w+\\s+(.+)`).exec(out)?.[1].trim() ?? null
  } catch {
    return null
  }
}

/** Папки игры из библиотек Steam (steamapps/common/*Tarkov*). */
function steamCandidates(): string[] {
  const steam = regValue('HKCU\\Software\\Valve\\Steam', 'SteamPath')
  if (!steam) return []
  const libs = [steam]
  try {
    // libraryfolders.vdf: "path"  "D:\\SteamLibrary"
    const vdf = readFileSync(join(steam, 'steamapps', 'libraryfolders.vdf'), 'utf8')
    for (const m of vdf.matchAll(/"path"\s+"([^"]+)"/g)) libs.push(m[1].replace(/\\\\/g, '\\'))
  } catch {
    /* библиотек кроме основной нет */
  }
  const out: string[] = []
  for (const lib of libs) {
    const common = join(lib, 'steamapps', 'common')
    try {
      for (const d of readdirSync(common)) if (/tarkov/i.test(d)) out.push(join(common, d))
    } catch {
      /* библиотека недоступна */
    }
  }
  return out
}

/** Типичные места установки на всех дисках. */
function commonCandidates(): string[] {
  const out: string[] = []
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const root = `${letter}:\\`
    if (!existsSync(root)) continue
    out.push(
      join(root, 'Battlestate Games', 'Escape from Tarkov'),
      join(root, 'Battlestate Games', 'EFT'),
      join(root, 'Escape from Tarkov'),
      join(root, 'Games', 'Escape from Tarkov')
    )
  }
  return out
}

export function detectGamePath(): string {
  const uninstall = 'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\EscapeFromTarkov'
  const fromLauncher = [
    regValue(`HKLM\\${uninstall}`, 'InstallLocation'),
    regValue(`HKLM\\${uninstall.replace('WOW6432Node\\', '')}`, 'InstallLocation')
  ].filter((p): p is string => !!p)
  for (const dir of [...fromLauncher, ...steamCandidates(), ...commonCandidates()]) {
    if (isGameDir(dir)) return dir
  }
  return fromLauncher[0] ?? 'C:\\Battlestate Games\\Escape from Tarkov'
}
