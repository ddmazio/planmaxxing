import { addDays } from 'date-fns'
import { ymd } from './dates'

/** \b do JS não entende acentos (amanhã, às); este helper usa fronteiras Unicode. */
const B = String.raw`(?:(?<![\p{L}\d])|(?![\p{L}\d]))`
function U(src: string, flags = '') { return new RegExp(src.replaceAll(String.raw`\b`, B), flags.includes('u') ? flags : flags + 'u') }

export type QuickKind = 'task' | 'event' | 'expense' | 'habit'
export interface Parsed {
  kind: QuickKind
  title: string
  date: string | null
  time: string | null
  amountCents: number | null
  category: 'needs' | 'wants' | 'savings' | null
  days: number[]
}

const WEEKDAYS: [RegExp, number][] = [
  [U(String.raw`\bdom(ingo)?\b`, ''), 0], [U(String.raw`\bseg(unda)?(-feira)?\b`, ''), 1], [U(String.raw`\bter(ça|ca)?(-feira)?\b`, ''), 2], [U(String.raw`\bqua(rta)?(-feira)?\b`, ''), 3],
  [U(String.raw`\bqui(nta)?(-feira)?\b`, ''), 4], [U(String.raw`\bsex(ta)?(-feira)?\b`, ''), 5], [U(String.raw`\bs[áa]b(ado)?\b`, ''), 6],
]
const WANTS = /(almo[çc]o|jantar|caf[ée]|restaurante|lanche|cinema|bar|uber|presente|roupa|compras?|streaming|netflix|spotify|ifood|delivery)/
const NEEDS = /(supermercado|mercado|renda|aluguel|luz|[áa]gua|g[áa]s|internet|telem[óo]vel|celular|farm[áa]cia|transporte|passe|metro|comboio|seguro|m[ée]dico|dentista)/
const SAVINGS = /(reserva|poupan[çc]a|investimento|pote|guardar)/

function nextWeekday(from: Date, wd: number) {
  const diff = (wd - from.getDay() + 7) % 7
  return addDays(from, diff === 0 ? 7 : diff)
}

/** Lê frases como "dentista sexta 15h", "almoço 12,50", "correr seg qua sex". */
export function parseQuick(input: string, now = new Date()): Parsed {
  let t = ` ${input.trim()} `
  const low = () => t.toLowerCase()
  const cut = (re: RegExp) => { t = t.replace(re, ' ') }
  let date: string | null = null, time: string | null = null, amountCents: number | null = null
  const days: number[] = []

  // dinheiro: 12,50 · 12.50 · €12 · 12€ · 12 euros
  const money = low().match(U(String.raw`(?:€\s*(\d+(?:[.,]\d{1,2})?))|(\d+(?:[.,]\d{1,2})?)\s*(?:€|eur\b|euros?\b|reais\b|r\$)|(?:r\$\s*(\d+(?:[.,]\d{1,2})?))|\b(\d+,\d{2})\b`, ''))
  if (money) {
    const raw = (money[1] ?? money[2] ?? money[3] ?? money[4])!.replace(',', '.')
    amountCents = Math.round(parseFloat(raw) * 100)
    t = t.slice(0, money.index!) + ' ' + t.slice(money.index! + money[0].length)
  }

  // hora: 15h · 15h30 · 15:30 · às 9
  const hm = low().match(U(String.raw`\b(?:às?\s*)?([01]?\d|2[0-3])(?:h|:)([0-5]\d)?\b`, '')) ?? low().match(U(String.raw`\bàs\s+([01]?\d|2[0-3])\b`, ''))
  if (hm) {
    time = `${hm[1].padStart(2, '0')}:${(hm[2] ?? '00')}`
    t = t.slice(0, hm.index!) + ' ' + t.slice(hm.index! + hm[0].length)
  }

  // datas relativas
  if (U(String.raw`\bdepois de amanh[ãa]\b`, '').test(low())) { date = ymd(addDays(now, 2)); cut(U(String.raw`\bdepois de amanh[ãa]\b`, 'i')) }
  else if (U(String.raw`\bamanh[ãa]\b`, '').test(low())) { date = ymd(addDays(now, 1)); cut(U(String.raw`\bamanh[ãa]\b`, 'i')) }
  else if (U(String.raw`\bhoje\b`, '').test(low())) { date = ymd(now); cut(U(String.raw`\bhoje\b`, 'i')) }

  // dd/mm(/aaaa)
  const dm = low().match(U(String.raw`\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b`, ''))
  if (!date && dm) {
    let y = dm[3] ? Number(dm[3].length === 2 ? '20' + dm[3] : dm[3]) : now.getFullYear()
    const cand = new Date(y, Number(dm[2]) - 1, Number(dm[1]))
    if (!dm[3] && cand < new Date(now.getFullYear(), now.getMonth(), now.getDate())) { y += 1; cand.setFullYear(y) }
    date = ymd(cand); t = t.slice(0, dm.index!) + ' ' + t.slice(dm.index! + dm[0].length)
  }
  // "dia 15"
  const dn = low().match(U(String.raw`\bdia\s+(\d{1,2})\b`, ''))
  if (!date && dn) {
    let cand = new Date(now.getFullYear(), now.getMonth(), Number(dn[1]))
    if (cand < new Date(now.getFullYear(), now.getMonth(), now.getDate())) cand = new Date(now.getFullYear(), now.getMonth() + 1, Number(dn[1]))
    date = ymd(cand); t = t.slice(0, dn.index!) + ' ' + t.slice(dn.index! + dn[0].length)
  }

  // dias da semana
  for (const [re, wd] of WEEKDAYS) {
    const g = new RegExp(re.source, 'iu')
    if (g.test(t)) { days.push(wd); t = t.replace(g, ' ') }
  }
  const everyDay = U(String.raw`\b(todo dia|todos os dias|diariamente)\b`, 'i')
  if (everyDay.test(t)) { days.splice(0, days.length, 0, 1, 2, 3, 4, 5, 6); t = t.replace(everyDay, ' ') }
  if (days.length === 1 && !date) date = ymd(nextWeekday(now, days[0]))

  t = t.replace(U(String.raw`\b(às|as|no|na|de|em|para|pra)\s*$`, 'i'), ' ').replace(/\s+/g, ' ').trim()
  const title = t ? t[0].toUpperCase() + t.slice(1) : ''
  const lowTitle = title.toLowerCase()

  let kind: QuickKind = 'task'
  let category: Parsed['category'] = null
  if (amountCents != null) {
    kind = 'expense'
    category = SAVINGS.test(lowTitle) ? 'savings' : NEEDS.test(lowTitle) ? 'needs' : WANTS.test(lowTitle) ? 'wants' : 'wants'
  } else if (days.length >= 2) kind = 'habit'
  else if (time) kind = 'event'

  if (kind === 'event' && !date) date = ymd(now)
  return { kind, title, date, time, amountCents, category, days: kind === 'habit' ? [...days].sort() : [] }
}
