import { useEffect, useMemo, useState } from 'react'
import type { StoryNode } from '@shared/types'
import type { AppState } from '../useAppState'
import { GuideView } from '../components/GuideView'
import { DECISIONS, ENDINGS, endingStatus, type EndingStatus } from '../storyEndings'

const doneKey = (slug: string) => `story:${slug}`
const prepKey = (ending: string, i: number) => `story-prep:${ending}:${i}`

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

const STATE_LABEL: Record<EndingStatus['state'], string> = { 'on-path': 'по пути', open: 'открыта', closed: 'закрыта' }

/**
 * Сюжет: главы и развилки с tarkov.help. Два способа идти по сюжету:
 *  — выбрать концовку заранее: подсвечивается путь, видно, что выбрать на развилках и что подготовить;
 *  — решать по ходу: отмечаете решения, которые уже приняли в игре, и видно, какие концовки ещё открыты.
 * Клик по главе открывает её гайд.
 */
export function StoryPage({ s }: { s: AppState }) {
  const [nodes, setNodes] = useState<StoryNode[] | null>(null)
  const profile = s.live?.profile ?? 'pvp'
  const [ending, setEnding] = useState<string | null>(() => loadEnding(profile))
  useEffect(() => setEnding(loadEnding(profile)), [profile])
  const [selected, setSelected] = useState<string | null>(null) // открытая глава; null — маршрут

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

  const choices = s.progress.storyChoices ?? {}
  const status = (slug: string) => endingStatus(slug, choices)
  const roots = nodes.filter((n) => !n.parents.length)
  const current = selected ? byslug.get(selected) : null
  const isDone = (key: string) => !!s.progress.objectives[key]
  const pickEnding = (slug: string | null) => {
    setEnding(slug)
    setSelected(null)
    try {
      if (slug) localStorage.setItem(`storyEnding:${profile}`, slug)
      else localStorage.removeItem(`storyEnding:${profile}`)
    } catch {
      // выбор проживёт до закрытия окна
    }
  }
  // короткое имя концовки: «Билет. Керман. "Спаситель"» -> «Керман. "Спаситель"»
  const short = (n: StoryNode) => (branch && n.name.startsWith(branch.name + '.') ? n.name.slice(branch.name.length + 1).trim() : n.name)
  const chapterName = (slug: string) => byslug.get(slug)?.name ?? slug
  // куда ведут решения: сначала концовки «по пути», потом те, что ещё возможны (с оговорками)
  const reachable = endings.filter((e) => status(e.slug).state !== 'closed')
  const onPath = endings.filter((e) => status(e.slug).state === 'on-path')
  const stillOpen = reachable.filter((e) => !onPath.includes(e))
  const decidedCount = DECISIONS.filter((d) => choices[d.key]).length

  const seen = new Set<string>()
  const renderNode = (n: StoryNode, depth: number): React.ReactNode => {
    if (seen.has(n.slug)) return null
    seen.add(n.slug)
    const isEnding = endings.includes(n)
    // чужая концовка или закрытая решениями — не наш путь
    const offPath = isEnding && ((!!chosen && n !== chosen) || status(n.slug).state === 'closed')
    const cls = [
      'story-node',
      n.slug === selected ? 'active' : '',
      path.has(n.slug) ? 'on-path' : '',
      offPath ? 'dim' : '',
      isDone(doneKey(n.slug)) ? 'done' : ''
    ].join(' ')
    return (
      <div key={n.slug}>
        <div className={cls} style={{ marginLeft: depth * 16 }}>
          <input
            type="checkbox"
            checked={isDone(doneKey(n.slug))}
            onChange={(e) => window.api.setObjectiveDone(doneKey(n.slug), e.target.checked)}
            title="Глава пройдена"
          />
          <button onClick={() => setSelected(n.slug)}>{isEnding ? short(n) : n.name}</button>
        </div>
        {!offPath && n.next.map((sl) => byslug.get(sl)).map((c) => c && renderNode(c, depth + 1))}
      </div>
    )
  }

  const total = chosen ? path.size : 0
  const passed = chosen ? [...path].filter((sl) => isDone(doneKey(sl))).length : 0

  return (
    <div className="story">
      <aside className="story-side">
        <button className={selected ? 'story-route-link' : 'story-route-link active'} onClick={() => setSelected(null)}>
          Маршрут к концовке
        </button>
        <div className="eyebrow">Главы</div>
        {roots.map((r) => renderNode(r, 0))}
        {/* главы без связей с остальными (если сайт их так отдал) */}
        {nodes.filter((n) => !seen.has(n.slug)).map((n) => renderNode(n, 0))}
      </aside>

      <section className="story-guide">
        {current ? (
          <>
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
          </>
        ) : (
          <div className="route">
            <h2>Маршрут к концовке</h2>
            <p className="muted">
              Можно выбрать концовку заранее — подсветится путь и будет видно, что выбрать на развилках и что подготовить.
              А можно решать по ходу: отмечайте решения, которые уже приняли в игре, и здесь будет видно, какие концовки
              ещё открыты.
            </p>

            <div className="eyebrow">Решения по ходу игры</div>
            <div className="decisions">
              {DECISIONS.map((d) => {
                const picked = d.options.find((o) => o.value === choices[d.key])
                return (
                  <div key={d.key} className="decision">
                    <div className="decision-head">
                      <b>{d.title}</b>
                      <button className="link-btn" onClick={() => setSelected(d.chapter)} title="Открыть гайд главы">
                        {chapterName(d.chapter)} →
                      </button>
                    </div>
                    <div className="seg seg-small">
                      <button className={!picked ? 'active' : ''} onClick={() => window.api.setStoryChoice(d.key, null)}>
                        Ещё не решил
                      </button>
                      {d.options.map((o) => (
                        <button key={o.value} className={picked === o ? 'active' : ''} onClick={() => window.api.setStoryChoice(d.key, o.value)}>
                          {o.label}
                        </button>
                      ))}
                    </div>
                    <div className="muted small">{picked ? picked.note : d.options.map((o) => `${o.label}: ${o.note}`).join(' ')}</div>
                  </div>
                )
              })}
            </div>
            {decidedCount > 0 && (
              <p className="route-summary">
                {reachable.length === 0
                  ? 'С такими решениями не подходит ни одна концовка — проверьте отметки.'
                  : [
                      onPath.length ? `Ваши решения ведут к ${onPath.map((e) => `«${short(e)}»`).join(', ')}.` : '',
                      stillOpen.length
                        ? `${onPath.length ? 'Ещё возможны' : 'Открыты'}: ${stillOpen.map((e) => `«${short(e)}»`).join(', ')}${stillOpen.some((e) => status(e.slug).warnings.length) ? ' — с оговорками, см. карточки ниже' : ''}.`
                        : ''
                    ]
                      .filter(Boolean)
                      .join(' ')}
              </p>
            )}

            <div className="eyebrow">Концовки · нажмите, чтобы выбрать цель</div>
            <div className="ending-cards">
              {endings.map((e) => {
                const st = status(e.slug)
                const info = ENDINGS[e.slug]
                const target = e === chosen
                return (
                  <div
                    key={e.slug}
                    className={`ending-card st-${st.state}${target ? ' target' : ''}`}
                    onClick={() => pickEnding(target ? null : e.slug)}
                    title={target ? 'Снять цель' : 'Сделать целью'}
                  >
                    <div className="ending-card-head">
                      <b>{short(e)}</b>
                      <span className={`tag ending-state-${st.state}`}>{target ? 'цель' : STATE_LABEL[st.state]}</span>
                    </div>
                    {info && (
                      <ul className="ending-needs">
                        {info.needs.map((n) => {
                          const c = choices[n.key]
                          const mark = !c ? '•' : c === n.value ? '✓' : n.strict ? '✗' : '!'
                          return (
                            <li key={n.key} className={!c ? '' : c === n.value ? 'ok' : n.strict ? 'bad' : 'warn'}>
                              <span className="need-mark">{mark}</span> {n.text}
                              {!n.strict && <span className="muted"> (желательно)</span>}
                            </li>
                          )
                        })}
                      </ul>
                    )}
                    {st.reasons.length > 0 && <div className="small ending-closed">Закрыта: {st.reasons.join('; ')}</div>}
                  </div>
                )
              })}
            </div>

            {chosen && (
              <div className="ending-prep">
                <div className="eyebrow">Подготовка к концовке «{short(chosen)}»</div>
                {(ENDINGS[chosen.slug]?.prep ?? []).map((p, i) => (
                  <label key={i} className="check">
                    <input
                      type="checkbox"
                      checked={isDone(prepKey(chosen.slug, i))}
                      onChange={(e) => window.api.setObjectiveDone(prepKey(chosen.slug, i), e.target.checked)}
                    />{' '}
                    {p}
                  </label>
                ))}
                <p className="muted small">
                  Путь к концовке подсвечен слева: пройдено {passed} из {total} глав. Подробности — в гайде концовки:{' '}
                  <button className="link-btn" onClick={() => setSelected(chosen.slug)}>
                    открыть
                  </button>
                </p>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
