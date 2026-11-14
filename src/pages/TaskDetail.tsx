import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { DEMO, insert, remove, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { fmt, fromYmd, todayYmd } from '../lib/dates'
import { REPEAT_LABEL, toggleTask } from '../lib/tasks'
import { EXEC_WEEKS, weekOf } from '../lib/cycle'
import type { Area, List, Step, Task, TaskItem } from '../lib/types'
import { Check, Sheet, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { useCycle } from './Ciclo'
import { usePeople } from './Grupo'

const localInput = (iso: string | null) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

export function TaskDetail({ task, onClose }: { task: Task; onClose: () => void }) {
  const nav = useNavigate()
  const { session } = useAuth()
  const { people } = usePeople()
  const { rows: items } = useRows<TaskItem>('task_items', { eq: { task_id: task.id }, order: { column: 'position' } })
  const { rows: lists } = useRows<List>('lists', { order: { column: 'position' } })
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const { cycle, goals, steps } = useCycle()
  const [newItem, setNewItem] = useState('')
  const [toStep, setToStep] = useState(false)
  const today = todayYmd()
  const set = (patch: Partial<Task>) => update<Task>('tasks', task.id, patch)
  const list = lists.find((l) => l.id === task.list_id)
  const step = steps.find((s) => s.id === task.step_id)
  const stepGoal = goals.find((g) => g.id === step?.goal_id)
  const next = items.find((i) => !i.done)
  const created = task.created_at ? new Date(task.created_at) : null
  const mine = !task.owner_id || task.owner_id === session?.user.id || DEMO
  const by = mine ? 'você' : people.find((p) => p.id === task.owner_id)?.display_name?.split(' ')[0] ?? 'alguém do grupo'
  const createdLabel = created ? (created.toISOString().slice(0, 10) === today ? 'hoje' : `em ${fmt(created, "d 'de' MMM")}`) : ''

  return (
    <div className="stack task-detail">
      <div className="row between">
        <span className="mono muted" style={{ textTransform: 'uppercase' }}>{step ? 'Passo da meta' : list?.name ?? 'Inbox'}</span>
        <button className="icon-btn" aria-label="Fechar" onClick={onClose}><Icon name="x" size={18} /></button>
      </div>

      <div className="card stack" style={{ gap: 0, padding: '6px 16px' }}>
        <div className="row" style={{ padding: '8px 0' }}>
          <Check done={!!task.completed_at} onToggle={() => toggleTask(task)} label="Concluir tarefa" />
          <input id="task-title" key={task.id} className="input bare grow h3" defaultValue={task.title} maxLength={300} aria-label="Título"
            onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== task.title) set({ title: v }) }} />
          <button aria-label="Importante" aria-pressed={task.important} onClick={() => set({ important: !task.important })} style={{ color: task.important ? 'var(--text-primary)' : 'var(--text-tertiary)' }}><Icon name="star" filled={task.important} /></button>
        </div>
        {items.map((it) => (
          <div key={it.id} className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
            <Check done={it.done} onToggle={() => update<TaskItem>('task_items', it.id, { done: !it.done })} label="Concluir etapa" />
            <div className="grow stack" style={{ gap: 0 }}>
              <span className={it.done ? 'done-text' : ''}>{it.title}</span>
              {it.id === next?.id && <span className="caption muted row" style={{ gap: 4 }}><Icon name="sun" size={12} />Próxima etapa · aparece no Hoje</span>}
            </div>
            <button aria-label="Apagar etapa" className="faint" onClick={() => remove('task_items', it.id)}><Icon name="x" size={16} /></button>
          </div>
        ))}
        <form className="row" style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }} onSubmit={async (e) => { e.preventDefault(); if (!newItem.trim()) return; const t = newItem.trim(); setNewItem(''); await insert<TaskItem>('task_items', { task_id: task.id, title: t, done: false, position: items.length + 1 }) }}>
          <Icon name="plus" size={18} className="faint" />
          <input className="input bare grow" placeholder={items.length ? 'Próxima etapa' : 'Adicionar etapa'} value={newItem} maxLength={200} onChange={(e) => setNewItem(e.target.value)} aria-label="Nova etapa" />
        </form>
      </div>

      <div className="card flush list">
        <div className="list-row"><Icon name="sun" /><span className="grow">Aparece no Hoje</span><Toggle label="Aparece no Hoje" on={task.my_day === today} onChange={(v) => set({ my_day: v ? today : null })} /></div>
        <label className="list-row"><Icon name="bell" /><span className="grow">Lembrete</span>
          <input type="datetime-local" className="input" style={{ width: 200, minHeight: 36 }} value={localInput(task.remind_at)} onChange={(e) => set({ remind_at: e.target.value ? new Date(e.target.value).toISOString() : null })} /></label>
      </div>

      <div className="card flush list">
        <label className="list-row"><Icon name="calendar" /><span className="grow">Data de conclusão</span>
          <input type="date" className="input" style={{ width: 160, minHeight: 36 }} value={task.due_on ?? ''} onChange={(e) => set({ due_on: e.target.value || null })} /></label>
        {task.due_on && <label className="list-row"><Icon name="clock" /><span className="grow">Hora</span>
          <input type="time" className="input" style={{ width: 130, minHeight: 36 }} value={task.due_time?.slice(0, 5) ?? ''} onChange={(e) => set({ due_time: e.target.value || null })} /></label>}
        <label className="list-row"><Icon name="repeat" /><span className="grow">Repetir</span>
          <select className="input" style={{ width: 160, minHeight: 36 }} value={task.repeat_rule ?? ''} onChange={(e) => set({ repeat_rule: (e.target.value || null) as Task['repeat_rule'] })}>
            <option value="">Não repete</option>{Object.entries(REPEAT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select></label>
      </div>

      <div className="card flush list">
        <label className="list-row"><Icon name="list" /><span className="grow">Lista</span>
          <select className="input" style={{ width: 180, minHeight: 36 }} value={task.list_id ?? ''} onChange={(e) => set({ list_id: e.target.value || null })}>
            <option value="">Inbox</option>{lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select></label>
        <label className="list-row"><Icon name="target" /><span className="grow">Área</span>
          <select className="input" style={{ width: 180, minHeight: 36 }} value={task.area_id ?? ''} onChange={(e) => set({ area_id: e.target.value || null })}>
            <option value="">Nenhuma</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
        {list && !DEMO ? (
          <button className="list-row" onClick={() => nav(`/tarefas/${list.id}?partilhar=1`)}><Icon name="users" /><span className="grow" style={{ textAlign: 'left' }}>Compartilhar</span><span className="caption muted">a lista {list.name}</span><Icon name="chevron" size={16} className="faint" /></button>
        ) : (
          <div className="list-row"><Icon name="users" /><span className="grow">Compartilhar</span><span className="caption muted">{DEMO ? 'precisa de conta' : 'mova para uma lista'}</span></div>
        )}
      </div>

      <label className="stack" style={{ gap: 6 }}><span className="mono muted">NOTA</span>
        <textarea key={task.id} className="input" rows={3} placeholder="Ex.: vence dia 15, lançar em Finanças como necessidade." defaultValue={task.notes ?? ''} maxLength={5000}
          onBlur={(e) => { if (e.target.value !== (task.notes ?? '')) set({ notes: e.target.value || null }) }} />
      </label>

      {step ? (
        <Link to="/ciclo" className="card soft row between" style={{ gap: 8 }}>
          <div className="stack" style={{ gap: 0 }}><span className="caption muted">Passo da semana {step.week}</span><span>{stepGoal?.title ?? 'Meta'}</span></div>
          <Icon name="chevron" size={16} />
        </Link>
      ) : (
        <button className="btn secondary" onClick={() => setToStep(true)} disabled={!cycle || !goals.length}><Icon name="target" size={16} />Transformar em passo de uma meta</button>
      )}
      {!step && (!cycle || !goals.length) && <span className="caption faint" style={{ marginTop: -8 }}>Precisa de um ciclo com metas.</span>}

      <div className="row between">
        <span className="caption faint">{created ? `Criada ${createdLabel} por ${by}` : ''}</span>
        <button className="caption danger" onClick={async () => { if (confirm('Excluir esta tarefa?')) { await remove('tasks', task.id); onClose() } }}>Excluir</button>
      </div>

      {cycle && <StepSheet open={toStep} onClose={() => setToStep(false)} task={task} goals={goals} current={Math.min(Math.max(weekOf(cycle), 1), EXEC_WEEKS)} />}
    </div>
  )
}

function StepSheet({ open, onClose, task, goals, current }: { open: boolean; onClose: () => void; task: Task; goals: { id: string; title: string }[]; current: number }) {
  const [picked, setGoal] = useState('')
  const goal = picked || goals[0]?.id || ''
  const [week, setWeek] = useState(current)
  return (
    <Sheet open={open} onClose={onClose} title="Transformar em passo" labelledBy="step-sheet">
      <p className="muted" style={{ margin: 0 }}>“{task.title}” vira um passo da meta e passa a contar no placar da semana. Concluir a tarefa conclui o passo.</p>
      <label className="field"><span>Meta</span>
        <select className="input" value={goal} onChange={(e) => setGoal(e.target.value)}>{goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
      <label className="field"><span>Semana</span>
        <select className="input" value={week} onChange={(e) => setWeek(Number(e.target.value))}>
          {Array.from({ length: EXEC_WEEKS }, (_, i) => i + 1).filter((w) => w >= current).map((w) => <option key={w} value={w}>Semana {w}{w === current ? ' (esta)' : ''}</option>)}
        </select></label>
      <button className="btn primary" disabled={!goal} onClick={async () => {
        const st = await insert<Step>('steps', { goal_id: goal, title: task.title, week, detail: task.due_on ? `até ${fmt(fromYmd(task.due_on), 'EEE, d MMM')}` : null, position: 999, done_at: task.completed_at })
        await update<Task>('tasks', task.id, { step_id: st.id })
        onClose()
      }}>Transformar</button>
    </Sheet>
  )
}
