import { useNavigate } from 'react-router-dom'
import { update } from '../lib/db'
import { fmt, fromYmd, todayYmd } from '../lib/dates'
import { toggleTask } from '../lib/tasks'
import type { Area, List, Task, TaskItem } from '../lib/types'
import { Icon } from './Icon'
import { AreaTag, Check } from './ui'

/** compact: no Hoje, a data de hoje não se repete (fica só a hora, como no Figma: “Casa · 18:00”). */
export function TaskRow({ task, lists, areas, compact, items, goalOfStep, href, selected, typed }: {
  task: Task; lists: List[]; areas: Area[]; compact?: boolean
  /** etapas da tarefa (para “2 de 4 etapas” e, no Hoje, a próxima etapa) */
  items?: TaskItem[]
  /** nome da meta de um passo (para “Passo da meta “…””) */
  goalOfStep?: (stepId: string) => string | undefined
  href?: string; selected?: boolean
  /** mostra a etiqueta “Tarefa” (na lista Para hoje, que mistura passos, tarefas e hábitos) */
  typed?: boolean
}) {
  const nav = useNavigate()
  const to = href ?? `/tarefa/${task.id}`
  const its = items ?? []
  const doneIts = its.filter((i) => i.done).length
  const nextIt = its.find((i) => !i.done)
  const goal = task.step_id ? goalOfStep?.(task.step_id) : undefined
  const list = lists.find((l) => l.id === task.list_id)
  const area = areas.find((a) => a.id === task.area_id)
  const today = todayYmd()
  const late = task.due_on && task.due_on < today && !task.completed_at
  const meta = [
    task.step_id ? (its.length || !goal ? 'Passo' : `Passo da meta “${goal}”`) : list?.name,
    its.length ? (compact && nextIt ? `próxima: ${nextIt.title}` : `${doneIts} de ${its.length} etapas`) : null,
    compact && task.due_on === today ? task.due_time?.slice(0, 5)
      : task.due_on && (task.due_on === today ? 'hoje' : fmt(fromYmd(task.due_on), 'EEE, d MMM')) + (task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''),
  ].filter(Boolean)
  return (
    <div className={'list-row' + (selected ? ' selected' : '')} role="button" tabIndex={0} aria-current={selected || undefined} onClick={() => nav(to)} onKeyDown={(e) => { if (e.key === 'Enter') nav(to) }}>
      <Check done={!!task.completed_at} onToggle={() => toggleTask(task)} label={task.completed_at ? 'Reabrir tarefa' : 'Concluir tarefa'} />
      <div className="grow">
        <div className={task.completed_at ? 'done-text' : ''}>{task.title}</div>
        {(meta.length > 0 || area || typed) && !task.completed_at && (
          <div className="row caption muted" style={{ gap: 6, flexWrap: 'wrap' }}>
            {typed && <span className="type-pill">Tarefa</span>}
            {meta.map((m, i) => <span key={i} style={late && i === meta.length - 1 ? { color: 'var(--danger)' } : undefined}>{i ? '· ' : ''}{m}</span>)}
            {task.repeat_rule && <Icon name="repeat" size={12} />}
            <AreaTag area={area} />
          </div>
        )}
      </div>
      <button aria-label={task.important ? 'Tirar de importante' : 'Marcar como importante'} aria-pressed={task.important}
        onClick={(e) => { e.stopPropagation(); update<Task>('tasks', task.id, { important: !task.important }) }}
        style={{ color: task.important ? 'var(--text-primary)' : 'var(--text-tertiary)', padding: 6 }}>
        <Icon name="star" size={18} filled={task.important} />
      </button>
    </div>
  )
}
