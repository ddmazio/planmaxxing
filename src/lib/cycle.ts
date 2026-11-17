import { addDays, differenceInCalendarDays } from 'date-fns'
import { fromYmd, ymd, fmt } from './dates'
import type { Cycle, Step } from './types'

/** Padrão: 12 semanas de execução + 1 semana de revisão. Cada ciclo pode ter outra duração. */
export const EXEC_WEEKS = 12
export const TOTAL_WEEKS = 13

/** Durações que todo mundo pode escolher; a dona do app testa também as curtas. */
export const DURATIONS = [8, 12]
export const DURATIONS_OWNER = [4, 6, 8, 12]

type Span = Pick<Cycle, 'starts_on' | 'ends_on'>
/** Semanas de execução deste ciclo (sem contar a semana de revisão), tiradas das datas. */
export function execWeeks(c?: Span | null) {
  if (!c) return EXEC_WEEKS
  const days = differenceInCalendarDays(fromYmd(c.ends_on), fromYmd(c.starts_on)) + 1
  return Math.max(1, Math.round(days / 7) - 1)
}
/** Semanas no total, com a de revisão. */
export const totalWeeks = (c?: Span | null) => execWeeks(c) + 1

export function newCycleDates(start: string, weeks = EXEC_WEEKS) {
  return { starts_on: start, ends_on: ymd(addDays(fromYmd(start), (weeks + 1) * 7 - 1)) }
}

/** O ciclo em curso: o mais recente que não foi encerrado. */
export function currentCycle(cycles: Cycle[]) {
  const open = [...cycles].filter((c) => c.status !== 'closed').sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1))
  // um ciclo ainda em planejamento (ritual do trimestre em andamento) não toma o lugar do que está acontecendo
  return open.find((c) => c.status !== 'planning') ?? open[0] ?? null
}

/** Semana do ciclo numa data: 0 se ainda não começou, total + 1 se já acabou. */
export function weekOf(c: Cycle, d = new Date()) {
  const diff = differenceInCalendarDays(d, fromYmd(c.starts_on))
  if (diff < 0) return 0
  return Math.min(totalWeeks(c) + 1, Math.floor(diff / 7) + 1)
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
