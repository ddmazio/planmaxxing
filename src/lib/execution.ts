import { addDays, fromYmd, ymd } from './dates'
import { EXEC_WEEKS } from './cycle'
import type { Area, Cycle, Goal, Habit, HabitLog, Step } from './types'

/** Dias da semana do ciclo (7 datas yyyy-MM-dd), a partir do início do ciclo. */
export function cycleWeekDays(c: Cycle, week: number) {
  const start = addDays(fromYmd(c.starts_on), (week - 1) * 7)
  return Array.from({ length: 7 }, (_, i) => ymd(addDays(start, i)))
}

/** Último dia das 12 semanas de execução (sem a semana de revisão). */
export const execEnd = (c: Cycle) => ymd(addDays(fromYmd(c.starts_on), EXEC_WEEKS * 7 - 1))

/**
 * Execução de cada área na semana: passos da semana feitos + hábitos marcados até hoje,
 * sobre passos planejados + vezes que o hábito estava previsto até hoje. null quando não há nada para medir.
 */
export function areaExecution(opts: {
  areas: Area[]; goals: Goal[]; steps: Step[]; habits: Habit[]; logs: HabitLog[]; week: number; days: string[]; today: string
}) {
  const { areas, goals, steps, habits, logs, week, days, today } = opts
  const out = new Map<string, number | null>()
  const elapsed = days.filter((d) => d <= today)
  for (const a of areas) {
    const ids = new Set(goals.filter((g) => g.area_id === a.id).map((g) => g.id))
    const st = steps.filter((s) => s.week === week && ids.has(s.goal_id))
    let planned = st.length
    let done = st.filter((s) => s.done_at).length
    for (const h of habits.filter((x) => x.area_id === a.id)) {
      const due = elapsed.filter((d) => h.days.includes(fromYmd(d).getDay()))
      planned += due.length
      done += logs.filter((l) => l.habit_id === h.id && due.includes(l.day)).length
    }
    out.set(a.id, planned ? Math.min(100, Math.round((done / planned) * 100)) : null)
  }
  return out
}
