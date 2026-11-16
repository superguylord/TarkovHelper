import { useEffect, useMemo, useState } from 'react'
import type { StoryNode } from '@shared/types'
import type { AppState } from '../useAppState'
import { GuideView } from '../components/GuideView'

const doneKey = (slug: string) => `story:${slug}`

function loadEnding(profile: string): string | null {
  try {
    return localStorage.getItem(`storyEnding:${profile}`)
  } catch {
    return null
  }
}

/** Все главы, от которых зависит глава slug (она сама и её предки). */
function pathTo(slug: string | null, byslug: Map<string, StoryNode>): Set<string> {
  const path = new Set<string>()
  const walk = (s: string) => {
    if (path.has(s)) return
    path.add(s)
    for (const p of byslug.get(s)?.parents ?? []) walk(p)
  }
  if (slug) walk(slug)
  return path
}

/**
 * Сюжет: главы и развилки с tarkov.help. Выбираете концовку — путь к ней подсвечивается,
 * остальные концовки приглушаются. Клик по главе открывает гайд.
 */
export function StoryPage({ s }: { s: AppState }) {
  const [nodes, setNodes] = useState<StoryNode[] | null>(null)
  const profile = s.live?.profile ?? 'pvp'
  const [ending, setEnding] = useState<string | null>(() => loadEnding(profile))
  useEffect(() => setEnding(loadEnding(profile)), [profile])
  const [selected, setSelected] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.api.getStory().then((n) => alive && setNodes(n))
    return () => {
      alive = false
    }
  }, [])

  const byslug = useMemo(() => new Map((nodes ?? []).map((n) => [n.slug, n])), [nodes])
  // развилка — глава (не корень), после которой несколько продолжений: это выбор концовки
  const branch = useMemo(
    () => [...(nodes ?? [])].filter((n) => n.parents.length && n.next.length >= 2).sort((a, b) => b.next.length - a.next.length)[0] ?? null,
    [nodes]
  )
  const endings = (branch?.next ?? []).map((sl) => byslug.get(sl)).filter((n): n is StoryNode => !!n)
  const chosen = endings.find((e) => e.slug === ending) ?? null
  const path = useMemo(() => pathTo(chosen?.slug ?? null, byslug), [chosen, byslug])

  if (!nodes) return <div className="empty">Загружаю сюжет с tarkov.help…</div>
  if (!nodes.length) return <div className="empty">Сюжет не загрузился — проверьте интернет и откройте раздел ещё раз.</div>

  const roots = nodes.filter((n) => !n.parents.length)
  const current = byslug.get(selected ?? '') ?? chosen ?? branch ?? roots[0]
  const isDone = (slug: string) => !!s.progress.objectives[doneKey(slug)]
  const pickEnding = (slug: string) => {
    setEnding(slug)
    setSelected(slug)
    try {
      localStorage.setItem(`storyEnding:${profile}`, slug)
    } catch {
      // выбор проживёт до закрытия окна
    }
  }
  // короткое имя концовки: «Билет. Керман. "Спаситель"» -> «Керман. "Спаситель"»
  const short = (n: StoryNode) => (branch && n.name.startsWith(branch.name + '.') ? n.name.slice(branch.name.length + 1).trim() : n.name)

  const seen = new Set<string>()
  const renderNode = (n: StoryNode, depth: number): React.ReactNode => {
    if (seen.has(n.slug)) return null
    seen.add(n.slug)
    const isEnding = endings.includes(n)
    // чужая концовка и всё, что идёт после неё, — не наш путь
    const otherEnding = !!chosen && isEnding && n !== chosen
    const cls = [
      'story-node',
      n.slug === current.slug ? 'active' : '',
      path.has(n.slug) ? 'on-path' : '',
      otherEnding ? 'dim' : '',
      isDone(n.slug) ? 'done' : ''
    ].join(' ')
    return (
      <div key={n.slug}>
        <div className={cls} style={{ marginLeft: depth * 16 }}>
          <input
            type="checkbox"
            checked={isDone(n.slug)}
            onChange={(e) => window.api.setObjectiveDone(doneKey(n.slug), e.target.checked)}
            title="Глава пройдена"
          />
          <button onClick={() => setSelected(n.slug)}>{isEnding ? short(n) : n.name}</button>
        </div>
        {!otherEnding && n.next.map((sl) => byslug.get(sl)).map((c) => c && renderNode(c, depth + 1))}
      </div>
    )
  }

  const total = chosen ? path.size : 0
  const passed = chosen ? [...path].filter(isDone).length : 0

  return (
    <div className="story">
      <aside className="story-side">
        <div className="eyebrow">К какой концовке иду</div>
        <div className="endings">
          {endings.map((e) => (
            <button key={e.slug} className={e === chosen ? 'ending active' : 'ending'} onClick={() => pickEnding(e.slug)}>
              {short(e)}
            </button>
          ))}
        </div>
        <p className="muted small">
          {chosen
            ? `Путь к концовке подсвечен: пройдено ${passed} из ${total} глав. Остальные главы — побочные сюжетные линии; что из них нужно для концовки, написано в её гайде.`
            : 'Выберите концовку — путь к ней подсветится, остальные концовки приглушатся.'}
        </p>
        <div className="eyebrow">Главы</div>
        {roots.map((r) => renderNode(r, 0))}
        {/* главы без связей с остальными (если сайт их так отдал) */}
        {nodes.filter((n) => !seen.has(n.slug)).map((n) => renderNode(n, 0))}
      </aside>
      <section className="story-guide">
        <h2>{current.name}</h2>
        {current.goals.length > 0 && (
          <ul className="story-goals">
            {current.goals.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        )}
        <div className="eyebrow">Как пройти · tarkov.help</div>
        <GuideView key={current.slug} taskName={current.name} slug={current.slug} />
      </section>
    </div>
  )
}
