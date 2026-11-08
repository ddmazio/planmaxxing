import { describe, expect, it } from 'vitest'
import { isBlue, milestone, streak, summarize } from './finance'
import { parseMoney } from './money'
import type { Expense, Income } from './types'

const rule = { needs_pct: 50, wants_pct: 30, savings_pct: 20 }
const inc = (amount: number, d: string, recurring = false) => ({ id: d + amount, item: 'x', amount_cents: amount, received_on: d, recurring }) as Income
const exp = (amount: number, d: string, category: Expense['category'] = 'needs', recurring = false) => ({ id: d + amount + category, item: 'y', amount_cents: amount, spent_on: d, category, recurring }) as Expense

describe('finanças', () => {
  it('lê valores em pt', () => {
    expect(parseMoney('12,50')).toBe(1250)
    expect(parseMoney('1.234,56')).toBe(123456)
    expect(parseMoney('€ 9')).toBe(900)
    expect(parseMoney('abc')).toBeNull()
    expect(parseMoney('1,234')).toBeNull()
  })
  it('recorrentes contam todo mês a partir da data', () => {
    const s = summarize('2026-12', [inc(100000, '2026-10-05', true)], [exp(40000, '2026-10-01', 'needs', true), exp(5000, '2026-11-02')], [], rule)
    expect(s.income).toBe(100000)
    expect(s.byCat.needs).toBe(40000)
    expect(s.plan.needs).toBe(50000)
    expect(s.left).toBe(60000)
  })
  it('guardar não conta como gasto', () => {
    const s = summarize('2026-11', [inc(1000, '2026-11-01')], [exp(900, '2026-11-02', 'savings')], [], rule)
    expect(s.spent).toBe(0)
    expect(isBlue(s)).toBe(true)
  })
  it('sequência no azul para no primeiro mês vermelho', () => {
    const incomes = [inc(1000, '2026-08-01', true)]
    const expenses = [exp(2000, '2026-08-10'), exp(500, '2026-09-10'), exp(500, '2026-10-10'), exp(300, '2026-11-03')]
    const get = (m: string) => summarize(m, incomes, expenses, [], rule)
    expect(streak('2026-11', get, '2026-08')).toBe(3)
    expect(milestone(3)).toEqual({ reached: 3, next: 6 })
  })
})
