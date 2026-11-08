import { addDays, addMonths, addWeeks, addYears } from 'date-fns'
import { insert, update } from './db'
import { fromYmd, todayYmd, ymd } from './dates'
import type { Task } from './types'

/** Conclui/reabre. Se a tarefa repete, cria a próxima ocorrência ao concluir. */
export async function toggleTask(t: Task) {
  if (t.completed_at) { await update<Task>('tasks', t.id, { completed_at: null }); return }
  await update<Task>('tasks', t.id, { completed_at: new Date().toISOString() })
  if (t.repeat_rule) {
    const base = t.due_on ? fromYmd(t.due_on) : new Date()
    let next = base
    switch (t.repeat_rule) {
      case 'daily': next = addDays(base, 1); break
      case 'weekdays': next = addDays(base, base.getDay() === 5 ? 3 : base.getDay() === 6 ? 2 : 1); break
      case 'weekly': next = addWeeks(base, 1); break
      case 'monthly': next = addMonths(base, 1); break
      case 'yearly': next = addYears(base, 1); break
    }
    const { id: _id, created_at: _c, updated_at: _u, owner_id: _o, completed_at: _d, ...rest } = t
    void _id; void _c; void _u; void _o; void _d
    await insert<Task>('tasks', { ...rest, due_on: ymd(next), my_day: null, completed_at: null })
  }
}

export const isToday = (t: Task) => {
  const today = todayYmd()
  return t.my_day === today || (t.due_on != null && t.due_on <= today)
}

export const SMART = {
  importante: { name: 'Importante', icon: 'star', color: 'relacoes', filter: (t: Task) => t.important },
  planejado: { name: 'Planejado', icon: 'calendar', color: 'estudos', filter: (t: Task) => t.due_on != null },
  passos: { name: 'Passos das metas', icon: 'target', color: 'saude', filter: (t: Task) => t.step_id != null },
  inbox: { name: 'Inbox', icon: 'inbox', color: 'neutro', filter: (t: Task) => t.list_id == null && t.step_id == null },
} as const
export type SmartKey = keyof typeof SMART

export const REPEAT_LABEL: Record<string, string> = { daily: 'Todo dia', weekdays: 'Dias úteis', weekly: 'Toda semana', monthly: 'Todo mês', yearly: 'Todo ano' }
