import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

// Простое хранилище JSON-файлов в папке пользователя (%APPDATA%/TarkovHelper).
const dir = () => {
  const d = app.getPath('userData')
  if (!existsSync(d)) mkdirSync(d, { recursive: true })
  return d
}

export function readJson<T>(name: string, fallback: T): T {
  const file = join(dir(), name)
  try {
    if (existsSync(file)) return { ...fallback, ...JSON.parse(readFileSync(file, 'utf8')) }
  } catch (e) {
    console.error(`Не удалось прочитать ${name}:`, e)
  }
  return fallback
}

export function writeJson(name: string, value: unknown): void {
  const file = join(dir(), name)
  // пишем во временный файл и переименовываем, чтобы не испортить данные при сбое
  writeFileSync(file + '.tmp', JSON.stringify(value))
  renameSync(file + '.tmp', file)
}
