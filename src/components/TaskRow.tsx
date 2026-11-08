import { useNavigate } from 'react-router-dom'
import { update } from '../lib/db'
import { fmt, fromYmd, todayYmd } from '../lib/dates'
import { toggleTask } from '../lib/tasks'
import type { Area, List, Task } from '../lib/types'
import { Icon } from './Icon'
import { AreaTag, Check } from './ui'

export function TaskRow({ task, lists, areas }: { task: Task; lists: List[]; areas: Area[] }) {
  const nav = useNavigate()
  const list = lists.find((l) => l.id === task.list_id)
  const area = areas.find((a) => a.id === task.area_id)
  const today = todayYmd()
  const late = task.due_on && task.due_on < today && !task.completed_at
  const meta = [
    list?.name,
    task.due_on && (task.due_on === today ? 'hoje' : fmt(fromYmd(task.due_on), 'EEE, d MMM')) + (task.due_time ? ` ${task.due_time.slice(0, 5)}` : ''),
  ].filter(Boolean)
  return (
    <div className="list-row" role="button" tabIndex={0} onClick={() => nav(`/tarefa/${task.id}`)} onKeyDown={(e) => { if (e.key === 'Enter') nav(`/tarefa/${task.id}`) }}>
      <Check done={!!task.completed_at} onToggle={() => toggleTask(task)} label={task.completed_at ? 'Reabrir tarefa' : 'Concluir tarefa'} />
      <div className="grow">
        <div className={task.completed_at ? 'done-text' : ''}>{task.title}</div>
        {(meta.length > 0 || area) && !task.completed_at && (
          <div className="row caption muted" style={{ gap: 6, flexWrap: 'wrap' }}>
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
