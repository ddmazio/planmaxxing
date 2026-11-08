import { Link, useOutletContext } from 'react-router-dom'
import { insert, remove } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { addDays, greeting, hhmm, longDay, toIso, todayYmd, ymd } from '../lib/dates'
import { isToday } from '../lib/tasks'
import type { Area, CalEvent, Habit, HabitLog, List, Task } from '../lib/types'
import { TaskRow } from '../components/TaskRow'
import { Check, Empty, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import type { ShellCtx } from '../components/Shell'

export function Hoje() {
  const { profile } = useAuth()
  const { openQuick } = useOutletContext<ShellCtx>()
  const today = todayYmd()
  const now = new Date()
  const { rows: tasks } = useRows<Task>('tasks', { eq: { completed_at: null } })
  const { rows: lists } = useRows<List>('lists')
  const { rows: areas } = useRows<Area>('areas')
  const { rows: events } = useRows<CalEvent>('events', { gte: { starts_at: toIso(today) }, lt: { starts_at: toIso(ymd(addDays(now, 1))) }, order: { column: 'starts_at' } })
  const { rows: habits } = useRows<Habit>('habits', { eq: { archived: false } })
  const { rows: logs } = useRows<HabitLog>('habit_logs', { eq: { day: today } })

  const todays = tasks.filter(isToday).sort((a, b) => Number(b.important) - Number(a.important))
  const habitsToday = habits.filter((h) => h.days.includes(now.getDay()))
  const areaOf = (id: string | null) => areas.find((a) => a.id === id)

  return (
    <div className="page wide">
      <header className="row between">
        <div className="stack" style={{ gap: 2 }}>
          <span className="mono muted">{longDay(now)}</span>
          <h1 className="h1">{greeting(now)}{profile?.display_name ? `, ${profile.display_name}` : ''}</h1>
        </div>
        <button className="btn primary small" onClick={openQuick}><Icon name="plus" size={16} />Novo</button>
      </header>

      <div className="grid2">
        <div className="stack">
          <SectionHead title="Agenda de hoje" action={<Link className="caption muted" to="/agenda">semana ›</Link>} />
          {events.length ? (
            <div className="card flush list">
              {events.map((e) => {
                const a = areaOf(e.area_id)
                return (
                  <Link key={e.id} to={`/agenda?evento=${e.id}`} className="list-row">
                    <span className="mono muted" style={{ width: 44 }}>{e.all_day ? 'dia' : hhmm(e.starts_at)}</span>
                    <span style={{ width: 4, height: 20, borderRadius: 2, background: `var(--${a?.color ?? 'neutro'}-fg)` }} />
                    <span className="grow">{e.title}</span>
                  </Link>
                )
              })}
            </div>
          ) : <Empty>Nada na agenda hoje.</Empty>}

          <SectionHead title="Hábitos" action={<span className="caption muted">{logs.length} de {habitsToday.length}</span>} />
          {habitsToday.length ? (
            <div className="card flush list">
              {habitsToday.map((h) => {
                const log = logs.find((l) => l.habit_id === h.id)
                return (
                  <div key={h.id} className="list-row">
                    <Check done={!!log} label={log ? `Desmarcar ${h.title}` : `Marcar ${h.title}`}
                      onToggle={() => (log ? remove('habit_logs', log.id) : insert<HabitLog>('habit_logs', { habit_id: h.id, day: today }))} />
                    <span className={'grow' + (log ? ' done-text' : '')}>{h.title}</span>
                  </div>
                )
              })}
            </div>
          ) : <Empty>Sem hábitos para hoje. Escreva no + algo como “ler 20 min todo dia”.</Empty>}
        </div>

        <div className="stack">
          <SectionHead title="Tarefas de hoje" action={<Link className="caption muted" to="/tarefas">listas ›</Link>} />
          <div className="card flush list">
            {todays.map((t) => <TaskRow key={t.id} task={t} lists={lists} areas={areas} />)}
            <button className="list-row muted" onClick={openQuick}><Icon name="plus" size={18} />Adicionar tarefa para hoje</button>
          </div>
          <div className="card soft caption">
            <b>Passos da semana</b> chegam com o Ciclo, na etapa 3. Por enquanto, o Hoje junta agenda, tarefas e hábitos.
          </div>
        </div>
      </div>
    </div>
  )
}
