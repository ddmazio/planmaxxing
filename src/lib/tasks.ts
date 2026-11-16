import { addDays, addMonths, addWeeks, addYears } from 'date-fns'
import { insert, remove, update } from './db'
import { undoable } from './undo'
import { fromYmd, todayYmd, ymd } from './dates'
import type { Step, Task } from './types'

/** Conclui/reabre. Se a tarefa repete, cria a próxima ocorrência ao concluir. */
export async function toggleTask(t: Task, opts: { undo?: boolean } = {}) {
  if (t.completed_at) { await update<Task>('tasks', t.id, { completed_at: null }); return }
  await update<Task>('tasks', t.id, { completed_at: new Date().toISOString() })
  let nextId: string | null = null
  if (opts.undo !== false) undoable('Tarefa concluída', async () => {
    await update<Task>('tasks', t.id, { completed_at: null })
    if (t.step_id) await update<Step>('steps', t.step_id, { done_at: null }).catch(() => {})
    if (nextId) await remove('tasks', nextId).catch(() => {})
  })
  // tarefa que virou passo de meta: concluir a tarefa conclui o passo
  if (t.step_id) await update<Step>('steps', t.step_id, { done_at: new Date().toISOString() }).catch(() => {})
  // tarefas ligadas ao Microsoft To Do: quem cria a próxima repetição é o To Do (chega pela sincronização)
  if (t.repeat_rule && !t.external_id?.startsWith('ms:')) {
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
    const created = await insert<Task>('tasks', { ...rest, due_on: ymd(next), my_day: null, completed_at: null })
    nextId = created.id
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

/** Passa para amanhã (sai do Hoje). */
export async function postponeTask(t: Task) {
  const tomorrow = ymd(addDays(fromYmd(todayYmd()), 1))
  const before = { my_day: t.my_day, due_on: t.due_on }
  await update<Task>('tasks', t.id, { my_day: null, due_on: tomorrow })
  undoable('Tarefa passada para amanhã', () => update<Task>('tasks', t.id, before))
}
