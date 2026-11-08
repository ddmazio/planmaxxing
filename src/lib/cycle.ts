import { addDays, differenceInCalendarDays } from 'date-fns'
import { fromYmd, ymd, fmt } from './dates'
import type { Cycle, Step } from './types'

/** 12 semanas de execução + 1 semana de revisão. */
export const EXEC_WEEKS = 12
export const TOTAL_WEEKS = 13

export function newCycleDates(start: string) {
  return { starts_on: start, ends_on: ymd(addDays(fromYmd(start), TOTAL_WEEKS * 7 - 1)) }
}

/** O ciclo em curso: o mais recente que não foi encerrado. */
export function currentCycle(cycles: Cycle[]) {
  return [...cycles].filter((c) => c.status !== 'closed').sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1))[0] ?? null
}

/** Semana do ciclo numa data: 0 se ainda não começou, 14 se já acabou. */
export function weekOf(c: Cycle, d = new Date()) {
  const diff = differenceInCalendarDays(d, fromYmd(c.starts_on))
  if (diff < 0) return 0
  return Math.min(TOTAL_WEEKS + 1, Math.floor(diff / 7) + 1)
}

export function daysUntil(c: Cycle, d = new Date()) { return differenceInCalendarDays(fromYmd(c.starts_on), d) }

export function weekRange(c: Cycle, week: number) {
  const a = addDays(fromYmd(c.starts_on), (week - 1) * 7)
  const b = addDays(a, 6)
  return `${fmt(a, 'd MMM')} a ${fmt(b, 'd MMM')}`
}

/** Execução: passos feitos sobre passos planejados (0 a 100), ou null se não houve plano. */
export function score(steps: Step[]) {
  if (!steps.length) return null
  return Math.round((steps.filter((s) => s.done_at).length / steps.length) * 100)
}

export const scoreLabel = (s: number | null) =>
  s == null ? 'sem passos' : s >= 85 ? 'semana forte' : s >= 65 ? 'no caminho' : 'dá para ajustar'
