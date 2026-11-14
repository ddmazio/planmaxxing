import { addMonths, format } from 'date-fns'
import { fromYmd, fmt } from './dates'
import type { BudgetRule, Expense, Income, Subscription } from './types'

export type Cat = 'needs' | 'wants' | 'savings'
export const CATS: Cat[] = ['needs', 'wants', 'savings']
export const CAT_NAME: Record<Cat, string> = { needs: 'Necessidades', wants: 'Desejos', savings: 'Economias' }
/** No singular, para o tipo de cada lançamento. */
export const CAT_ONE: Record<Cat, string> = { needs: 'Necessidade', wants: 'Desejo', savings: 'Economia' }
export const CAT_HINT: Record<Cat, string> = { needs: 'casa, contas, transporte, mínimo das dívidas', wants: 'restaurantes, streaming, compras, presentes', savings: 'reserva, investimentos, pagar dívidas mais rápido' }

/** Palavras que costumam indicar o tipo do gasto (para a sugestão ao lançar). */
const HINTS: [Cat, string, RegExp][] = [
  ['savings', 'reserva', /reserva|poupan|invest|emerg|guardar|pote|tesouro|ppr/],
  ['needs', 'casa e contas', /renda de casa|aluguel|condom|luz|água|agua|gás|gas\b|internet|telem|celular|seguro|imposto|irs/],
  ['needs', 'mercado', /supermerc|mercado|mercearia|continente|pingo doce|lidl|aldi|minipreço|farm[aá]c/],
  ['needs', 'transporte', /passe|navegante|metro|comboio|autocarro|ônibus|onibus|combust|gasolina|portagem/],
  ['wants', 'restaurantes', /restaur|almo[cç]o|jantar|caf[eé]|lanche|bar\b|pizza|sushi|ifood|uber eats|glovo|bolt food/],
  ['wants', 'streaming', /streaming|netflix|spotify|disney|hbo|max\b|prime|youtube|apple tv/],
  ['wants', 'compras e presentes', /compra|roupa|sapato|presente|zara|amazon|shein|livro|cinema|show|concerto|viagem/],
]
export function suggestCat(item: string): { cat: Cat; why: string } | null {
  const t = item.toLowerCase()
  for (const [cat, why, re] of HINTS) if (re.test(t)) return { cat, why }
  return null
}
export const CAT_COLOR: Record<Cat, string> = { needs: 'estudos', wants: 'relacoes', savings: 'saude' }
export const DEFAULT_RULE: BudgetRule = { needs_pct: 50, wants_pct: 30, savings_pct: 20 }

/** "2026-11" */
export const ym = (d: Date) => format(d, 'yyyy-MM')
export const monthStart = (m: string) => `${m}-01`
export const nextMonth = (m: string) => ym(addMonths(fromYmd(monthStart(m)), 1))
export const prevMonth = (m: string) => ym(addMonths(fromYmd(monthStart(m)), -1))
export const monthName = (m: string) => fmt(fromYmd(monthStart(m)), 'MMMM')
export const monthLong = (m: string) => fmt(fromYmd(monthStart(m)), "MMMM 'de' yyyy")

/** Itens do mês: os lançados nele + os que repetem todo mês desde antes. */
export function inMonth<T extends { recurring: boolean }>(rows: T[], dateKey: keyof T, m: string) {
  const a = monthStart(m), b = monthStart(nextMonth(m))
  return rows.filter((r) => {
    const d = r[dateKey] as unknown as string
    return r.recurring ? d < b : d >= a && d < b
  })
}

export function subsInMonth(subs: Subscription[], m: string) {
  const b = monthStart(nextMonth(m))
  return subs.filter((s) => (s.created_at ?? '0').slice(0, 10) < b)
}

export interface MonthSummary {
  income: number; spent: number; left: number
  byCat: Record<Cat, number>; plan: Record<Cat, number>; subs: number
}

export function summarize(m: string, incomes: Income[], expenses: Expense[], subs: Subscription[], rule: BudgetRule): MonthSummary {
  const inc = inMonth(incomes, 'received_on', m).reduce((s, r) => s + r.amount_cents, 0)
  const exp = inMonth(expenses, 'spent_on', m)
  const subTotal = subsInMonth(subs, m).reduce((s, r) => s + r.amount_cents, 0)
  const byCat: Record<Cat, number> = { needs: 0, wants: subTotal, savings: 0 }
  for (const e of exp) byCat[e.category] += e.amount_cents
  // dinheiro guardado não é "gasto": a sobra conta só essenciais e desejos
  const spent = byCat.needs + byCat.wants
  const plan: Record<Cat, number> = {
    needs: Math.round((inc * rule.needs_pct) / 100),
    wants: Math.round((inc * rule.wants_pct) / 100),
    savings: Math.round((inc * rule.savings_pct) / 100),
  }
  return { income: inc, spent, left: inc - spent - byCat.savings, byCat, plan, subs: subTotal }
}

/** Mês "no azul": entrou dinheiro e os essenciais + desejos não passaram do que entrou. */
export const isBlue = (s: MonthSummary) => s.income > 0 && s.spent <= s.income

/** Sequência de meses no azul até agora. O mês atual só conta se já está no azul. */
export function streak(current: string, get: (m: string) => MonthSummary, first: string | null) {
  if (!first) return 0
  let n = 0
  let m = current
  if (isBlue(get(m))) n++
  m = prevMonth(m)
  while (m >= first) {
    if (!isBlue(get(m))) break
    n++
    m = prevMonth(m)
  }
  return n
}

export const MILESTONES = [1, 3, 6, 12, 24]
export function milestone(n: number) {
  const reached = MILESTONES.filter((x) => n >= x).pop() ?? 0
  const next = MILESTONES.find((x) => x > n) ?? null
  return { reached, next }
}
