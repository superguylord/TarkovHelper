import { net } from 'electron'

// Сетевые запросы через Chromium (как в браузере), а не через fetch из Node:
// у Node жёсткий таймаут подключения 10 с, и медленные серверы (json.tarkov.dev бывает таким)
// «падают», хотя в браузере открываются. Плюс один повтор при сетевой ошибке.
export async function httpFetch(url: string, init?: RequestInit, retries = 1): Promise<Response> {
  try {
    return await net.fetch(url, init)
  } catch (e) {
    if (retries <= 0) throw e
    await new Promise((r) => setTimeout(r, 1500))
    return httpFetch(url, init, retries - 1)
  }
}
