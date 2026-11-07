import { useEffect, useMemo, useState } from 'react'
import type { QuestGuide } from '@shared/types'

type Block =
  | { kind: 'text'; text: string; href?: string }
  | { kind: 'img'; src: string; caption: string }

const SITE = 'https://tarkov.help'

/**
 * Разбираем HTML гайда в простые блоки: текст и картинки с подписями.
 * В DOM страницы ничего из чужого HTML не вставляем — только текст и адреса картинок.
 */
function parseGuide(html: string): Block[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const blocks: Block[] = []
  const abs = (url: string) => (url.startsWith('/') ? SITE + url : url)

  const image = (el: Element) => {
    const img = el.matches('img') ? el : el.querySelector('img')
    const src = img?.getAttribute('src')
    if (!src || !/^https?:|^\//.test(src)) return
    const caption = el.querySelector('.bb-image__text span')?.textContent?.trim() || img?.getAttribute('alt') || ''
    blocks.push({ kind: 'img', src: abs(src), caption })
  }

  const visit = (el: Element) => {
    if (el.matches('.bb-image, img')) return image(el)
    if (el.matches('iframe')) {
      const src = el.getAttribute('src')
      if (src) blocks.push({ kind: 'text', text: 'Видео к гайду', href: abs(src) })
      return
    }
    // текст элемента без вложенных картинок с подписями
    const copy = el.cloneNode(true) as Element
    copy.querySelectorAll('.bb-image, img, iframe').forEach((n) => n.remove())
    const text = copy.textContent?.replace(/\s+/g, ' ').trim()
    if (text) {
      const a = copy.querySelector('a[href]')
      const href = a && a.textContent?.trim() === text ? abs(a.getAttribute('href')!) : undefined
      blocks.push({ kind: 'text', text, href })
    }
    el.querySelectorAll('.bb-image, iframe').forEach((n) => visit(n))
    el.querySelectorAll('img').forEach((n) => !n.closest('.bb-image') && image(n))
  }

  for (const el of Array.from(doc.body.children)) visit(el)
  // подряд идущие одинаковые строки (например, «==========») не нужны
  return blocks.filter((b, i) => !(b.kind === 'text' && /^=+$/.test(b.text)) && JSON.stringify(b) !== JSON.stringify(blocks[i - 1]))
}

const cache = new Map<string, Promise<QuestGuide | null>>()

export function GuideView({ taskName }: { taskName: string }) {
  const [guide, setGuide] = useState<QuestGuide | null | 'loading' | 'error'>('loading')
  const [zoom, setZoom] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setGuide('loading')
    let p = cache.get(taskName)
    if (!p) {
      p = window.api.getGuide(taskName)
      cache.set(taskName, p)
    }
    p.then((g) => alive && setGuide(g)).catch(() => {
      cache.delete(taskName)
      if (alive) setGuide('error')
    })
    return () => {
      alive = false
    }
  }, [taskName])

  const blocks = useMemo(() => (guide && typeof guide === 'object' ? parseGuide(guide.html) : []), [guide])

  if (guide === 'loading') return <div className="muted">Загружаю гайд с tarkov.help…</div>
  if (guide === 'error') return <div className="muted">Не удалось загрузить гайд — проверьте интернет.</div>
  if (!guide || !blocks.length) {
    return (
      <div className="muted">
        На tarkov.help нет гайда для этого квеста.{' '}
        <a
          href={`https://escapefromtarkov.fandom.com/ru/wiki/Special:Search?query=${encodeURIComponent(taskName)}`}
          target="_blank"
          rel="noreferrer"
        >
          Поискать в вики
        </a>
      </div>
    )
  }

  return (
    <div className="guide">
      {blocks.map((b, i) =>
        b.kind === 'img' ? (
          <figure key={i} className="guide-img" onClick={() => setZoom(b.src)}>
            <img src={b.src} alt={b.caption} loading="lazy" />
            {b.caption && <figcaption>{b.caption}</figcaption>}
          </figure>
        ) : b.href ? (
          <p key={i}>
            <a href={b.href} target="_blank" rel="noreferrer">
              {b.text}
            </a>
          </p>
        ) : (
          <p key={i}>{b.text}</p>
        )
      )}
      <a className="small" href={guide.url} target="_blank" rel="noreferrer">
        Открыть на tarkov.help
      </a>
      {zoom && (
        <div className="lightbox" onClick={() => setZoom(null)}>
          <img src={zoom} alt="" />
        </div>
      )}
    </div>
  )
}
