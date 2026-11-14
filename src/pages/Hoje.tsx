import { Link, useOutletContext } from 'react-router-dom'
import { insert, remove, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, greeting, hhmm, toIso, todayYmd, weekDays, ymd } from '../lib/dates'
import { isToday } from '../lib/tasks'
import { EXEC_WEEKS, TOTAL_WEEKS, weekOf } from '../lib/cycle'
import { areaExecution, cycleWeekDays, execEnd } from '../lib/execution'
import type { CalEvent, Habit, HabitLog, List, Step, Task } from '../lib/types'
import { TaskRow } from '../components/TaskRow'
import { AreaTag, Check, Empty, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import type { ShellCtx } from '../components/Shell'
import { useCycle } from './Ciclo'
import { useCalendars } from '../lib/calendars'

const LETTER = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']
const toggleStep = (s: Step) => update<Step>('steps', s.id, { done_at: s.done_at ? null : new Date().toISOString() })

/** “Ela é estudiosa, é amada…”: as frases do Who is she viram uma citação só. */
function quote(lines: string[]) {
  const s = lines.map((l) => l.trim().replace(/[.;]+$/, '')).filter(Boolean)
  if (!s.length) return null
  return s.join('. ') + '.'
}

export function Hoje() {
  const { profile } = useAuth()
  const { openQuick, openSearch } = useOutletContext<ShellCtx>()
  const today = todayYmd()
  const now = new Date()
  const { cycle, goals, steps, areas, loading } = useCycle()
  const week = cycle ? weekOf(cycle) : 0
  const inExec = !!cycle && week >= 1 && week <= EXEC_WEEKS
  const days = inExec ? cycleWeekDays(cycle!, week) : weekDays(now, profile?.week_starts_on ?? 1).map(ymd)

  const { rows: tasks } = useRows<Task>('tasks', { eq: { completed_at: null } })
  const { rows: lists } = useRows<List>('lists')
  const { rows: loadedEvents } = useRows<CalEvent>('events', { gte: { starts_at: toIso(ymd(addDays(now, -35))) }, lt: { starts_at: toIso(ymd(addDays(now, 1))) }, order: { column: 'starts_at' } })
  const events = loadedEvents.filter((e) => e.ends_at > toIso(today)) // inclui os de vários dias que continuam hoje
  const { rows: habits } = useRows<Habit>('habits', { eq: { archived: false } })
  const { rows: logs } = useRows<HabitLog>('habit_logs', { gte: { day: days[0] } })

  const cals = useCalendars(areas)
  const visibleEvents = events.filter(cals.visible)
  const todays = tasks.filter(isToday).sort((a, b) => Number(b.important) - Number(a.important) || (a.due_time ?? '99').localeCompare(b.due_time ?? '99'))
  const habitsToday = habits.filter((h) => h.days.includes(now.getDay()))
  const logsToday = logs.filter((l) => l.day === today)
  const weekSteps = inExec ? steps.filter((s) => s.week === week) : []
  const doneSteps = weekSteps.filter((s) => s.done_at).length
  const exec = areaExecution({ areas: areas.filter((a) => !a.is_fixed), goals, steps, habits, logs, week, days, today })
  const goalOf = (id: string) => goals.find((g) => g.id === id)
  const first = profile?.display_name?.split(' ')[0]
  const q = cycle ? quote(cycle.who_is_she) : null
  const emptyCycle = !!cycle && !loading && goals.length === 0

  const eyebrow = [fmt(now, 'EEEE · d MMM'), cycle && (inExec ? `semana ${week} de ${EXEC_WEEKS}` : week === TOTAL_WEEKS ? 'semana de revisão' : null)].filter(Boolean).join(' · ')

  return (
    <div className="page wide">
      <header className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="stack grow" style={{ gap: 2 }}>
          <span className="mono muted" style={{ textTransform: 'uppercase' }}>{eyebrow}</span>
          <h1 className="h1">{greeting(now)}{first ? `, ${first}` : ''}</h1>
        </div>
        <button className="search-btn desktop-only" onClick={openSearch}><Icon name="search" size={16} /><span className="grow">Buscar</span><span className="kbd">⌘K</span></button>
        <div className="row mobile-only" style={{ gap: 8 }}>
          <button className="icon-btn" aria-label="Buscar" onClick={openSearch}><Icon name="search" size={18} /></button>
          <Link to="/grupo" className="icon-btn" aria-label="Grupo"><Icon name="users" size={18} /></Link>
          <Link to="/config" className="icon-btn ink" aria-label="Configurações" style={{ fontWeight: 500 }}>{(profile?.display_name || '?').charAt(0).toUpperCase()}</Link>
        </div>
      </header>

      {/* ciclo + Who is she | placar da semana */}
      {cycle ? (
        <div className="hoje-hero">
          <Link to="/ciclo" className="card ink stack cycle-card">
            <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 8 }}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="medium">{cycle.name} · {EXEC_WEEKS} semanas</span>
                <span className="mono" style={{ opacity: 0.6, textTransform: 'uppercase' }}>{fmt(fromYmd(cycle.starts_on), 'd MMM')} → {fmt(fromYmd(execEnd(cycle)), 'd MMM')}</span>
              </div>
              {cycle.words.length > 0 && <div className="wordchips on-ink">{cycle.words.slice(0, 3).map((w) => <span key={w}>{w}</span>)}</div>}
            </div>
            <div className="weeks on-ink" aria-label={`Semana ${week} de ${TOTAL_WEEKS}`}>
              {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((w) => <span key={w} className={w === week ? 'now' : w < week ? 'past' : w === TOTAL_WEEKS ? 'review' : ''} />)}
            </div>
            {q ? <p className="serif quote">“{q}”</p> : <p className="caption" style={{ opacity: 0.7, margin: 0 }}>Escreva o “Who is she?” deste ciclo: quem você é no fim dele.</p>}
          </Link>

          <div className="card stack week-card">
            <div className="row between"><span className="medium">Passos desta semana</span><span className="big" style={{ fontSize: 28 }}>{doneSteps} / {weekSteps.length}</span></div>
            <div className="bar"><span style={{ width: `${weekSteps.length ? (doneSteps / weekSteps.length) * 100 : 0}%` }} /></div>
            <div className="daystrip">
              {days.map((d) => {
                const dt = fromYmd(d)
                return (
                  <div key={d} className={'day' + (d === today ? ' today' : d < today ? ' past' : '')} aria-current={d === today ? 'date' : undefined}>
                    <span className="mono">{d === today ? fmt(dt, 'EEE').slice(0, 3).toUpperCase() : LETTER[dt.getDay()]}</span>
                    <span className="num">{dt.getDate()}</span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      ) : !loading && (
        <Link to="/ciclo" className="card ink row between">
          <div className="stack" style={{ gap: 2 }}><span className="h3">Um ano cabe em 12 semanas.</span><span className="caption" style={{ opacity: 0.7 }}>Crie o seu ciclo para ver aqui as metas, os passos e a execução de cada área.</span></div>
          <Icon name="chevron" />
        </Link>
      )}

      {emptyCycle && (
        <div className="card stack">
          <span className="h3">Seu ciclo começou. Ainda não tem nada aqui, e tudo bem.</span>
          <span className="muted">Comece com uma meta só. O resto (passos, hábitos, agenda) aparece aqui sozinho.</span>
          <Link className="btn primary" style={{ alignSelf: 'flex-start' }} to="/ciclo">Criar a primeira meta</Link>
          <span className="mono muted" style={{ marginTop: 8 }}>Ou comece por</span>
          <div className="card flush list" style={{ background: 'var(--bg-canvas)' }}>
            <Link className="list-row" to="/ciclo"><span className="grow">Escrever o “Who is she?” deste ciclo</span><Icon name="chevron" size={16} /></Link>
            <button className="list-row" onClick={openQuick}><span className="grow" style={{ textAlign: 'left' }}>Adicionar um hábito simples</span><Icon name="chevron" size={16} /></button>
            <Link className="list-row" to="/grupo"><span className="grow">Convidar alguém para o grupo</span><Icon name="chevron" size={16} /></Link>
          </div>
        </div>
      )}

      <div className="grid2">
        <div className="stack">
          <SectionHead title="Tarefas de hoje" action={<Link className="caption muted" to="/tarefas">listas →</Link>} />
          <div className="card flush list">
            {todays.map((t) => <TaskRow key={t.id} task={t} lists={lists} areas={areas} compact />)}
            <button className="list-row muted" onClick={openQuick}><Icon name="plus" size={18} />Adicionar tarefa para hoje</button>
          </div>

          {cycle && !emptyCycle && (
            <>
              <SectionHead title={inExec ? `Passos da semana ${week}` : 'Passos da semana'} action={<Link className="caption muted" to="/ciclo">plano →</Link>} />
              {weekSteps.length ? (
                <div className="card flush list">
                  {weekSteps.map((s) => {
                    const g = goalOf(s.goal_id)
                    return (
                      <div key={s.id} className="list-row">
                        <Check done={!!s.done_at} onToggle={() => toggleStep(s)} label={s.done_at ? `Desmarcar ${s.title}` : `Concluir ${s.title}`} />
                        <div className="grow stack" style={{ gap: 2 }}>
                          <span className={s.done_at ? 'done-text' : ''}>{s.title}</span>
                          {g && <span className="caption muted">{g.title}</span>}
                        </div>
                        <AreaTag area={areas.find((a) => a.id === g?.area_id)} />
                      </div>
                    )
                  })}
                </div>
              ) : <Empty>{inExec ? <>Nenhum passo planejado para esta semana. <Link className="link" to="/ciclo/ritual">Fazer o ritual</Link></> : 'Fora das 12 semanas de execução.'}</Empty>}
            </>
          )}
        </div>

        <div className="stack">
          <SectionHead title="Áreas da vida" action={<span className="mono muted">Execução</span>} />
          <div className="card flush list">
            {areas.filter((a) => !a.is_fixed).map((a) => {
              const v = exec.get(a.id) ?? null
              return (
                <Link key={a.id} to={`/ciclo/area/${a.id}`} className="list-row area-exec">
                  <span className="dot" style={{ background: `var(--${a.color}-fg)`, width: 10, height: 10 }} />
                  <span className="grow">{a.name}</span>
                  <div className="bar" style={{ width: 96 }}><span style={{ width: `${v ?? 0}%`, background: `var(--${a.color}-fg)` }} /></div>
                  <span className="mono" style={{ width: 36, textAlign: 'right' }}>{v == null ? '–' : `${v}%`}</span>
                </Link>
              )
            })}
          </div>
          <p className="caption muted" style={{ margin: '-4px 0 0' }}>Passos da semana e hábitos de cada área, até hoje.</p>

          <SectionHead title="Agenda de hoje" action={<Link className="caption muted" to="/agenda">semana →</Link>} />
          {visibleEvents.length ? (
            <div className="card flush list">
              {visibleEvents.map((e) => (
                <Link key={e.id} to={`/agenda?evento=${e.id}`} className="list-row">
                  <span className="mono muted" style={{ width: 44 }}>{e.all_day || e.starts_at < toIso(today) ? 'dia' : hhmm(e.starts_at)}</span>
                  <span style={{ width: 4, height: 20, borderRadius: 2, background: cals.paint(e).fg }} />
                  <span className="grow">{e.title}</span>
                </Link>
              ))}
            </div>
          ) : <Empty>Nada na agenda hoje.</Empty>}

          <SectionHead title="Hábitos" action={<span className="caption muted">{logsToday.length} de {habitsToday.length}</span>} />
          {habitsToday.length ? (
            <div className="card flush list">
              {habitsToday.map((h) => {
                const log = logsToday.find((l) => l.habit_id === h.id)
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
      </div>
    </div>
  )
}
