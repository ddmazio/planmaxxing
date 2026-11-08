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
import { useWeekSteps } from './Ciclo'
import { useCalendars } from '../lib/calendars'
import { AreaTag } from '../components/ui'

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

  const ws = useWeekSteps()
  const cals = useCalendars(areas)
  const visibleEvents = events.filter(cals.visible)
  const todays = tasks.filter(isToday).sort((a, b) => Number(b.important) - Number(a.important))
  const habitsToday = habits.filter((h) => h.days.includes(now.getDay()))

  return (
    <div className="page wide">
      <header className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="stack grow" style={{ gap: 2 }}>
          <span className="mono muted">{longDay(now)}</span>
          <h1 className="h1">{greeting(now)}{profile?.display_name ? `, ${profile.display_name.split(' ')[0]}` : ''}</h1>
        </div>
        <button className="btn primary small desktop-only" onClick={openQuick}><Icon name="plus" size={16} />Novo</button>
        <div className="row mobile-only" style={{ gap: 8 }}>
          <Link to="/grupo" className="icon-btn" aria-label="Grupo"><Icon name="users" size={18} /></Link>
          <Link to="/config" className="icon-btn ink" aria-label="Configurações" style={{ fontWeight: 500 }}>{(profile?.display_name || '?').charAt(0).toUpperCase()}</Link>
        </div>
      </header>

      <div className="grid2">
        <div className="stack">
          <SectionHead title="Agenda de hoje" action={<Link className="caption muted" to="/agenda">semana ›</Link>} />
          {visibleEvents.length ? (
            <div className="card flush list">
              {visibleEvents.map((e) => {
                return (
                  <Link key={e.id} to={`/agenda?evento=${e.id}`} className="list-row">
                    <span className="mono muted" style={{ width: 44 }}>{e.all_day ? 'dia' : hhmm(e.starts_at)}</span>
                    <span style={{ width: 4, height: 20, borderRadius: 2, background: cals.paint(e).fg }} />
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
          <SectionHead title={ws.cycle && ws.week >= 1 && ws.week <= 12 ? `Passos da semana ${ws.week}` : 'Passos da semana'} action={<Link className="caption muted" to="/ciclo">ciclo ›</Link>} />
          {!ws.cycle ? <Empty>Sem ciclo em curso. <Link className="link" to="/ciclo">Criar meu ciclo de 12 semanas</Link></Empty>
            : ws.items.length ? (
              <div className="card flush list">
                {ws.items.map(({ step, goal, area }) => (
                  <div key={step.id} className="list-row">
                    <Check done={!!step.done_at} onToggle={() => ws.toggle!(step)} label={step.done_at ? `Desmarcar ${step.title}` : `Concluir ${step.title}`} />
                    <div className="grow stack" style={{ gap: 2 }}>
                      <span className={step.done_at ? 'done-text' : ''}>{step.title}</span>
                      {goal && <span className="caption muted">{goal.title}</span>}
                    </div>
                    <AreaTag area={area} />
                  </div>
                ))}
              </div>
            ) : <Empty>Nenhum passo planejado para esta semana. <Link className="link" to="/ciclo/ritual">Fazer o ritual</Link></Empty>}
        </div>
      </div>
    </div>
  )
}
