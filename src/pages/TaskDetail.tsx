import { useState } from 'react'
import { insert, remove, update } from '../lib/db'
import { useRows } from '../lib/hooks'
import { todayYmd } from '../lib/dates'
import { REPEAT_LABEL, toggleTask } from '../lib/tasks'
import type { Area, List, Task, TaskItem } from '../lib/types'
import { Check, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'

export function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const { rows: items } = useRows<TaskItem>('task_items', { eq: { task_id: task.id }, order: { column: 'position' } })
  const { rows: lists } = useRows<List>('lists', { order: { column: 'position' } })
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const [newItem, setNewItem] = useState('')
  const today = todayYmd()
  const set = (patch: Partial<Task>) => update<Task>('tasks', task.id, patch)

  return (
    <div className="stack">
      <div className="row between">
        <button className="btn ghost small" onClick={onClose}><Icon name="back" size={16} />Voltar</button>
        <button className="icon-btn" aria-label="Apagar tarefa" onClick={async () => { if (confirm('Apagar esta tarefa?')) { await remove('tasks', task.id); onClose() } }}><Icon name="trash" size={18} /></button>
      </div>

      <div className="card stack" style={{ gap: 0, padding: '6px 16px' }}>
        <div className="row" style={{ padding: '8px 0' }}>
          <Check done={!!task.completed_at} onToggle={() => toggleTask(task)} label="Concluir tarefa" />
          <input id="task-title" className="input bare grow h3" defaultValue={task.title} maxLength={300} aria-label="Título"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== task.title) set({ title: v }) }} />
          <button aria-label="Importante" aria-pressed={task.important} onClick={() => set({ important: !task.important })} style={{ color: task.important ? 'var(--text-primary)' : 'var(--text-tertiary)' }}><Icon name="star" filled={task.important} /></button>
        </div>
        {items.map((it) => (
          <div key={it.id} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <Check done={it.done} onToggle={() => update<TaskItem>('task_items', it.id, { done: !it.done })} label="Concluir etapa" />
            <span className={'grow' + (it.done ? ' done-text' : '')}>{it.title}</span>
            <button aria-label="Apagar etapa" className="faint" onClick={() => remove('task_items', it.id)}><Icon name="x" size={16} /></button>
          </div>
        ))}
        <form className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }} onSubmit={async (e) => { e.preventDefault(); if (!newItem.trim()) return; await insert<TaskItem>('task_items', { task_id: task.id, title: newItem.trim(), done: false, position: items.length + 1 }); setNewItem('') }}>
          <Icon name="plus" size={18} className="faint" />
          <input className="input bare grow" placeholder="Próxima etapa" value={newItem} maxLength={200} onChange={(e) => setNewItem(e.target.value)} aria-label="Nova etapa" />
        </form>
      </div>

      <div className="card flush list">
        <div className="list-row"><Icon name="sun" /><span className="grow">Aparece no Hoje</span><Toggle label="Aparece no Hoje" on={task.my_day === today} onChange={(v) => set({ my_day: v ? today : null })} /></div>
      </div>

      <div className="card flush list">
        <label className="list-row"><Icon name="calendar" /><span className="grow">Data</span>
          <input type="date" className="input" style={{ width: 170, minHeight: 36 }} value={task.due_on ?? ''} onChange={(e) => set({ due_on: e.target.value || null })} /></label>
        <label className="list-row"><Icon name="clock" /><span className="grow">Hora</span>
          <input type="time" className="input" style={{ width: 130, minHeight: 36 }} value={task.due_time?.slice(0, 5) ?? ''} onChange={(e) => set({ due_time: e.target.value || null })} /></label>
        <label className="list-row"><Icon name="repeat" /><span className="grow">Repetir</span>
          <select className="input" style={{ width: 170, minHeight: 36 }} value={task.repeat_rule ?? ''} onChange={(e) => set({ repeat_rule: (e.target.value || null) as Task['repeat_rule'] })}>
            <option value="">Não repete</option>{Object.entries(REPEAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
      </div>

      <div className="card flush list">
        <label className="list-row"><Icon name="list" /><span className="grow">Lista</span>
          <select className="input" style={{ width: 190, minHeight: 36 }} value={task.list_id ?? ''} onChange={(e) => set({ list_id: e.target.value || null })}>
            <option value="">Inbox</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        <label className="list-row"><Icon name="target" /><span className="grow">Área</span>
          <select className="input" style={{ width: 190, minHeight: 36 }} value={task.area_id ?? ''} onChange={(e) => set({ area_id: e.target.value || null })}>
            <option value="">Nenhuma</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
      </div>

      <label className="field"><span>Nota</span>
        <textarea className="input" defaultValue={task.notes ?? ''} maxLength={5000} onBlur={(e) => { if (e.target.value !== (task.notes ?? '')) set({ notes: e.target.value || null }) }} />
      </label>
      <p className="caption faint" style={{ margin: 0 }}>Criada em {new Date(task.created_at ?? Date.now()).toLocaleDateString('pt-PT')}</p>
    </div>
  )
}
