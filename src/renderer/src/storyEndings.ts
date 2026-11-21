// Развилки сюжета и что нужно для каждой концовки — коротко, по гайдам tarkov.help
// («Билет» и четыре главы-концовки). Концовки привязаны к адресам глав на сайте; если сайт их
// переименует, концовки останутся в списке, просто без подсказок.

export interface Decision {
  key: string
  chapter: string // адрес главы, где принимается решение
  title: string
  options: { value: string; label: string; note: string }[]
}

export const DECISIONS: Decision[] = [
  {
    key: 'case',
    chapter: 'nebesa-v-ogne',
    title: 'Кейс из самолёта («Небеса в огне»)',
    options: [
      {
        value: 'prapor',
        label: 'Отдал Прапору',
        note: 'Быстрая концовка Прапора обойдётся в 300 млн ₽, но понадобится Смотритель Маяка. «Падший» закрыт.'
      },
      {
        value: 'self',
        label: 'Оставил себе',
        note: 'Нужно для «Падшего». Быстрая концовка Прапора — 500 млн ₽, зато без Смотрителя.'
      }
    ]
  },
  {
    key: 'kerman',
    chapter: 'bilet',
    title: 'Керман после вскрытия кейса («Билет»)',
    options: [
      { value: 'help', label: 'Работаю с Керманом', note: 'Открыты «Спаситель», «Падший» и «Остаться в Таркове».' },
      { value: 'refuse', label: 'Отказался от помощи', note: 'Остаётся только быстрая концовка Прапора «Выживший».' }
    ]
  },
  {
    key: 'lightkeeper',
    chapter: 'bilet',
    title: 'Смотритель Маяка',
    options: [
      {
        value: 'open',
        label: 'Открываю',
        note: 'Нужен для «Остаться в Таркове», для «Спасителя» (через главу «Батя») и для «Выжившего» с кейсом у Прапора. «Падший» закрыт.'
      },
      { value: 'closed', label: 'Не открываю', note: 'Обязательно для «Падшего».' }
    ]
  }
]

export interface Need {
  key: string
  value: string
  strict: boolean // без этого концовка закрыта; иначе — только рекомендация
  text: string
}

export interface EndingInfo {
  needs: Need[]
  prep: string[] // что подготовить заранее
}

const BASE_PREP = [
  '40 физических биткоинов',
  'Ключ-карта TerraGroup Labs (чёрная)',
  'Меченые ключи — для «Чистой RFID-карты»'
]

export const ENDINGS: Record<string, EndingInfo> = {
  'bilet-kerman': {
    needs: [
      { key: 'kerman', value: 'help', strict: true, text: 'Всегда помогать Керману' },
      { key: 'case', value: 'prapor', strict: false, text: 'Кейс лучше отдать Прапору, а потом вернуть через Смотрителя' },
      { key: 'lightkeeper', value: 'open', strict: false, text: 'Открыть Смотрителя Маяка — нужен для главы «Батя»' }
    ],
    prep: [
      'Пройти все сюжетные линии и собрать весь компромат (глава «Записки для прохождения Билет на 100%»)',
      ...BASE_PREP,
      'Репутация у Скупщика 1.0+, затем 4.0+ (помогают квесты Водителя БТР)',
      'Убежище: Солнечная батарея 1 уровня'
    ]
  },
  'bilet-prapor': {
    needs: [
      { key: 'kerman', value: 'help', strict: true, text: 'Пройти через задания Кермана' },
      { key: 'case', value: 'self', strict: true, text: 'Кейс в «Небесах в огне» оставить себе' },
      { key: 'lightkeeper', value: 'closed', strict: true, text: 'Не открывать Смотрителя Маяка' }
    ],
    prep: [...BASE_PREP, 'Убежище: Солнечная батарея']
  },
  'bilet-smotritel-mayaka-ostatsya-v-tarkove': {
    needs: [
      { key: 'kerman', value: 'help', strict: true, text: 'Пройти через задания Кермана' },
      { key: 'lightkeeper', value: 'open', strict: true, text: 'Открыть Смотрителя Маяка (в главе «Батя»)' },
      { key: 'case', value: 'prapor', strict: false, text: 'Кейс отдать Прапору (если оставить — другое достижение)' }
    ],
    prep: [...BASE_PREP, 'Репутация у Скупщика 1.0+ — чтобы открыть Смотрителя']
  },
  'bilet-prapor-bistro': {
    needs: [
      { key: 'kerman', value: 'refuse', strict: true, text: 'Отказаться от помощи Кермана сразу после вскрытия кейса' },
      { key: 'case', value: 'prapor', strict: false, text: 'Кейс лучше отдать Прапору: 300 млн ₽ вместо 500 млн ₽' }
    ],
    prep: [
      'Если кейс у Прапора: 300 млн ₽ и открытый Смотритель Маяка (репутация Скупщика 1.0+)',
      'Если кейс у себя: 500 млн ₽, Смотритель не нужен'
    ]
  }
}

export type EndingStatus = { state: 'closed' | 'on-path' | 'open'; reasons: string[]; warnings: string[] }

/**
 * Где концовка относительно принятых решений: закрыта (противоречит обязательному), «по пути»
 * (все обязательные решения приняты как надо) или ещё открыта. warnings — нарушенные рекомендации.
 */
export function endingStatus(slug: string, choices: Record<string, string>): EndingStatus {
  const info = ENDINGS[slug]
  if (!info) return { state: 'open', reasons: [], warnings: [] }
  const reasons: string[] = []
  const warnings: string[] = []
  let decided = 0
  for (const n of info.needs) {
    const c = choices[n.key]
    if (!c) continue
    if (c === n.value) {
      if (n.strict) decided++
    } else (n.strict ? reasons : warnings).push(n.text)
  }
  const strictCount = info.needs.filter((n) => n.strict).length
  // «по пути» — все обязательные решения приняты как надо и ни одна рекомендация не нарушена
  const state = reasons.length ? 'closed' : decided === strictCount && strictCount > 0 && !warnings.length ? 'on-path' : 'open'
  return { state, reasons, warnings }
}
