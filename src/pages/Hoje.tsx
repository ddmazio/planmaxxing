import { useEffect, useState, type ReactNode } from 'react'
import { Link, useOutletContext } from 'react-router-dom'
import { insert, remove, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, greeting, hhmm, toIso, todayYmd, weekDays, ymd } from '../lib/dates'
import { isToday, postponeTask, toggleTask } from '../lib/tasks'
import { undoable } from '../lib/undo'
import { SwipeRow } from '../components/SwipeRow'
import { execWeeks, totalWeeks, weekOf } from '../lib/cycle'
import { areaExecution, cycleWeekDays, execEnd } from '../lib/execution'
import type { CalEvent, Habit, HabitLog, List, Step, Task, TaskItem } from '../lib/types'
import { TaskRow } from '../components/TaskRow'
import { AreaIcon, AreaTag, Check, Empty, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import type { ShellCtx } from '../components/Shell'
import { useCycle } from './Ciclo'
import { useCalendars } from '../lib/calendars'
import { useFeature } from '../lib/app'

const toggleStep = async (s: Step) => {
  await update<Step>('steps', s.id, { done_at: s.done_at ? null : new Date().toISOString() })
  if (!s.done_at) undoable('Passo concluído', () => update<Step>('steps', s.id, { done_at: null }))
}
const markHabit = async (habitId: string, day: string) => {
  const log = await insert<HabitLog>('habit_logs', { habit_id: habitId, day })
  undoable('Hábito marcado', () => remove('habit_logs', log.id))
}

type Kind = 'tudo' | 'passo' | 'tarefa' | 'habito'
const OPEN_KEY = 'hoje-abertos'
const readOpen = (): Record<string, boolean> => { try { return JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') } catch { return {} } }
/** seção que abre e fecha; o app lembra a escolha (4.5) */
function useFold(id: string, initial: boolean) {
  const [open, setOpen] = useState<boolean>(() => readOpen()[id] ?? initial)
  const toggle = () => setOpen((o) => { const n = !o; try { localStorage.setItem(OPEN_KEY, JSON.stringify({ ...readOpen(), [id]: n })) } catch { /* */ } return n })
  return [open, toggle] as const
}
function FoldHead({ title, count, open, onToggle, controls }: { title: string; count?: string; open: boolean; onToggle: () => void; controls: string }) {
  return (
    <button className="fold-head" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      <h2 className="section-title grow">{title}</h2>
      {count && <span className="count-pill">{count}</span>}
      <Icon name="chevron" size={18} className={'fold-chev' + (open ? ' open' : '')} />
    </button>
  )
}
const mins = (ms: number) => { const m = Math.max(0, Math.round(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, '0') : ''}` : `${m} min` }
function TypePill({ children }: { children: ReactNode }) { return <span className="type-pill">{children}</span> }

/** “Ela é estudiosa, é amada…”: as frases do Who is she viram uma citação só. */
function quote(lines: string[]) {
  const s = lines.map((l) => l.trim().replace(/[.;]+$/, '')).filter(Boolean)
  if (!s.length) return null
  // frases que continuam a anterior (começam em minúscula) viram uma frase só: “Ela é estudiosa, é amada e conquista…”
  if (s.length > 1 && s.slice(1).every((x) => x[0] === x[0].toLowerCase())) return s.slice(0, -1).join(', ') + ' e ' + s[s.length - 1] + '.'
  return s.join('. ') + '.'
}

export function Hoje() {
  const { profile } = useAuth()
  const { openQuick } = useOutletContext<ShellCtx>()
  const today = todayYmd()
  const now = new Date()
  const { cycle, goals, steps, areas, loading } = useCycle()
  const week = cycle ? weekOf(cycle) : 0
  const EXEC_WEEKS = execWeeks(cycle), TOTAL_WEEKS = totalWeeks(cycle)
  const inExec = !!cycle && week >= 1 && week <= EXEC_WEEKS
  const days = inExec ? cycleWeekDays(cycle!, week) : weekDays(now, profile?.week_starts_on ?? 1).map(ymd)

  const { rows: tasks } = useRows<Task>('tasks', { eq: { completed_at: null } })
  const { rows: lists } = useRows<List>('lists')
  const { rows: items } = useRows<TaskItem>('task_items', { order: { column: 'position' } })
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

  // relógio para o cartão Agora
  const [tick, setTick] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setTick(Date.now()), 30000); return () => clearInterval(t) }, [])
  const timed = visibleEvents.filter((e) => !e.all_day && e.starts_at >= toIso(today))
  const nowIso = new Date(tick).toISOString()
  const current = timed.find((e) => e.starts_at <= nowIso && e.ends_at > nowIso)
  const next = timed.find((e) => e.starts_at > nowIso)
  const pendingSteps = weekSteps.filter((s) => !s.done_at)
  const suggest = useFeature('sugestao_agora')
  const suggestion = !suggest ? null : pendingSteps[0] ? { title: pendingSteps[0].title, sub: goalOf(pendingSteps[0].goal_id)?.title ?? 'passo da semana', to: '/ciclo' }
    : todays[0] ? { title: todays[0].title, sub: 'tarefa de hoje', to: `/tarefa/${todays[0].id}` } : null

  const [agendaOpen, toggleAgenda] = useFold('agenda', false)
  const [placarOpen, togglePlacar] = useFold('placar', false)
  const [listOpen, toggleList] = useFold('parahoje', true)
  const [kind, setKind] = useState<Kind>('tudo')
  const habitsDone = habitsToday.filter((h) => logsToday.some((l) => l.habit_id === h.id)).length
  const listTotal = weekSteps.length + todays.length + habitsToday.length
  const listDone = doneSteps + habitsDone
  const pct = weekSteps.length ? Math.round((doneSteps / weekSteps.length) * 100) : null

  const eyebrow = [fmt(now, 'EEEE · d MMM'), cycle && (inExec ? `semana ${week} de ${EXEC_WEEKS}` : week === TOTAL_WEEKS ? 'semana de revisão' : null)].filter(Boolean).join(' · ')

  return (
    <div className="page wide">
      <header className="row between" style={{ alignItems: 'flex-start' }}>
        <div className="stack grow" style={{ gap: 2 }}>
          <span className="mono muted" style={{ textTransform: 'uppercase' }}>{eyebrow}</span>
          <h1 className="h1">{greeting(now)}{first ? `, ${first}` : ''}</h1>
        </div>
      </header>

      <div className="hoje-hero">
        {/* 4.1 · Agora / Livre */}
        {current ? (
          <Link to={`/agenda?evento=${current.id}`} className="card ink agora">
            <div className="row between"><span className="mono agora-k">Agora · até {hhmm(current.ends_at)}</span><span className="mono agora-m">{mins(new Date(current.ends_at).getTime() - tick)} restantes</span></div>
            <span className="serif agora-t">{current.title}</span>
            <div className="agora-bar"><span style={{ width: `${Math.min(100, ((tick - new Date(current.starts_at).getTime()) / (new Date(current.ends_at).getTime() - new Date(current.starts_at).getTime())) * 100)}%` }} /></div>
            {next && <div className="row agora-next"><span className="mono agora-m">Depois</span><span className="grow">{hhmm(next.starts_at)} · {next.title}</span><Icon name="chevron" size={16} /></div>}
          </Link>
        ) : (
          <div className="card lime agora livre">
            <div className="row between"><span className="mono">{next ? `Livre até ${hhmm(next.starts_at)}` : 'Livre o resto do dia'}</span>{next && <span className="mono">{mins(new Date(next.starts_at).getTime() - tick)} livres</span>}</div>
            <span className="serif agora-t">{suggestion ? 'Que tal adiantar um passo?' : 'Um respiro na agenda.'}</span>
            {suggestion ? (
              <div className="row agora-next">
                <span className="grow stack" style={{ gap: 0, minWidth: 0 }}><span className="medium ellipsis">{suggestion.title}</span><span className="caption">{suggestion.sub}</span></span>
                <Link to={suggestion.to} className="btn primary small">Abrir</Link>
              </div>
            ) : (
              <div className="row agora-next"><span className="grow caption">{next ? `Próximo: ${next.title}` : 'Nada marcado. Use o + para anotar o que vier.'}</span><button className="btn primary small" onClick={openQuick}>Novo</button></div>
            )}
          </div>
        )}

        {/* 4.2 · Placar da semana */}
        {cycle ? (
          <div className="card stack placar">
            <button className="placar-head" aria-expanded={placarOpen} aria-controls="placar-corpo" onClick={togglePlacar}>
              <span className="grow stack" style={{ gap: 2, textAlign: 'left' }}>
                <span className="mono muted">{cycle.name} · {inExec ? `semana ${week} de ${EXEC_WEEKS}` : week === TOTAL_WEEKS ? 'semana de revisão' : week === 0 ? 'começa em breve' : 'terminou'}</span>
                <span className="medium">Placar da semana</span>
              </span>
              <span className="serif placar-n">{pct == null ? '–' : `${pct}%`}</span>
              <Icon name="chevron" size={18} className={'fold-chev' + (placarOpen ? ' open' : '')} />
            </button>
            <div className="weeks placar-weeks" style={{ gridTemplateColumns: `repeat(${TOTAL_WEEKS}, 1fr)` }} aria-label={`Semana ${week} de ${TOTAL_WEEKS}`}>
              {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((w) => <span key={w} className={w === week ? 'now' : w < week ? 'past' : w === TOTAL_WEEKS ? 'review' : ''} />)}
            </div>
            {placarOpen && (
              <div id="placar-corpo" className="stack" style={{ gap: 12 }}>
                {q ? <p className="serif placar-q">“{q}”</p> : <Link to="/ciclo" className="caption muted">Escreva o “Who is she?” deste ciclo: quem você é no fim dele.</Link>}
                <div className="placar-stats">
                  <div><span className="mono-n">{doneSteps}/{weekSteps.length}</span><span className="caption muted">passos</span></div>
                  <div><span className="mono-n">{habitsDone}/{habitsToday.length}</span><span className="caption muted">hábitos hoje</span></div>
                  <div><span className="mono-n">{fmt(fromYmd(execEnd(cycle)), 'd MMM')}</span><span className="caption muted">fim do ciclo</span></div>
                </div>
                {cycle.words.length > 0 && <div className="wordchips">{cycle.words.slice(0, 3).map((w) => <span key={w}>{w}</span>)}</div>}
                <Link to="/ciclo" className="caption muted">Abrir o plano do ciclo →</Link>
              </div>
            )}
          </div>
        ) : !loading && (
          <Link to="/ciclo" className="card ink row between">
            <div className="stack" style={{ gap: 2 }}><span className="h3">Um ano cabe em 12 semanas.</span><span className="caption" style={{ opacity: 0.7 }}>Crie o seu ciclo para ver aqui as metas, os passos e a execução de cada área.</span></div>
            <Icon name="chevron" />
          </Link>
        )}
      </div>

      {emptyCycle && (
        <div className="card stack">
          <span className="h3">{week === 0 ? `Seu ciclo começa em ${fmt(fromYmd(cycle!.starts_on), "d 'de' MMM")}. Ainda não tem nada aqui, e tudo bem.` : 'Seu ciclo começou. Ainda não tem nada aqui, e tudo bem.'}</span>
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
        {/* 4.4 · Para hoje: passos, tarefas e hábitos numa lista só */}
        <div className="stack">
          <FoldHead title="Para hoje" count={`${listDone} de ${listTotal}`} open={listOpen} onToggle={toggleList} controls="para-hoje" />
          {listOpen ? (
            <div id="para-hoje" className="stack" style={{ gap: 10 }}>
              <div className="chips" role="group" aria-label="Filtrar">
                {([['tudo', 'Tudo'], ['passo', 'Passos'], ['tarefa', 'Tarefas'], ['habito', 'Hábitos']] as [Kind, string][]).map(([k, l]) => (
                  <button key={k} className={'chip' + (kind === k ? ' on' : '')} aria-pressed={kind === k} onClick={() => setKind(k)}>{l}</button>
                ))}
              </div>
              <div className="card flush list">
                {(kind === 'tudo' || kind === 'passo') && weekSteps.map((s) => {
                  const g = goalOf(s.goal_id)
                  return (
                    <SwipeRow key={s.id} actions={s.done_at ? [] : [
                      ...(week < EXEC_WEEKS ? [{ label: 'Adiar', icon: 'clock', tone: 'mustard' as const, run: async () => { await update<Step>('steps', s.id, { week: s.week + 1 }); undoable('Passo foi para a próxima semana', () => update<Step>('steps', s.id, { week: s.week })) } }] : []),
                      { label: 'Feito', icon: 'check', tone: 'lime' as const, run: () => toggleStep(s) }]}>
                    <div className="list-row">
                      <Check done={!!s.done_at} onToggle={() => toggleStep(s)} label={s.done_at ? `Desmarcar ${s.title}` : `Concluir ${s.title}`} />
                      <div className="grow stack" style={{ gap: 4, minWidth: 0 }}>
                        <span className={s.done_at ? 'done-text' : ''}>{s.title}</span>
                        <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}><TypePill>Passo</TypePill><AreaTag area={areas.find((a) => a.id === g?.area_id)} />{g && <span className="caption muted ellipsis">{g.title}</span>}</span>
                      </div>
                    </div>
                    </SwipeRow>
                  )
                })}
                {(kind === 'tudo' || kind === 'tarefa') && todays.map((t) => (
                  <SwipeRow key={t.id} actions={[{ label: 'Amanhã', icon: 'clock', tone: 'mustard', run: () => postponeTask(t) }, { label: 'Feito', icon: 'check', tone: 'lime', run: () => toggleTask(t) }]}>
                    <TaskRow task={t} lists={lists} areas={areas} compact typed items={items.filter((i) => i.task_id === t.id)} />
                  </SwipeRow>
                ))}
                {(kind === 'tudo' || kind === 'habito') && habitsToday.map((h) => {
                  const log = logsToday.find((l) => l.habit_id === h.id)
                  return (
                    <SwipeRow key={h.id} actions={log ? [] : [{ label: 'Feito', icon: 'check', tone: 'lime', run: () => markHabit(h.id, today) }]}>
                    <div className="list-row">
                      <Check done={!!log} label={log ? `Desmarcar ${h.title}` : `Marcar ${h.title}`}
                        onToggle={() => (log ? remove('habit_logs', log.id) : markHabit(h.id, today))} />
                      <Link to={`/habito/${h.id}`} className="grow stack" style={{ gap: 4, minWidth: 0 }}>
                        <span className={log ? 'done-text' : ''}>{h.title}</span>
                        <span className="row" style={{ gap: 6 }}><TypePill>Hábito</TypePill><AreaTag area={areas.find((a) => a.id === h.area_id)} /></span>
                      </Link>
                    </div>
                    </SwipeRow>
                  )
                })}
                {listTotal === 0 && <div className="list-row caption muted">Nada para hoje ainda.</div>}
                <button className="list-row muted" onClick={openQuick}><Icon name="plus" size={18} />Adicionar para hoje</button>
              </div>
              {cycle && inExec && !weekSteps.length && !emptyCycle && <Empty>Nenhum passo planejado para esta semana. <Link className="link" to="/ciclo/ritual">Fazer o ritual</Link></Empty>}
            </div>
          ) : (
            <button className="card fold-sum" onClick={toggleList}>
              <span className="caption medium">{listTotal - listDone} pendentes{suggestion ? ` · próximo: ${suggestion.title}` : ''}</span>
              <div className="bar"><span style={{ width: `${listTotal ? (listDone / listTotal) * 100 : 0}%` }} /></div>
            </button>
          )}
        </div>

        <div className="stack">
          {/* 4.3 · Agenda de hoje */}
          <FoldHead title="Agenda de hoje" count={String(visibleEvents.length)} open={agendaOpen} onToggle={toggleAgenda} controls="agenda-hoje" />
          {agendaOpen ? (
            <div id="agenda-hoje" className="stack" style={{ gap: 8 }}>
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
              <Link className="caption muted" to="/agenda">Ver a semana →</Link>
            </div>
          ) : (
            <button className="card fold-sum row" onClick={toggleAgenda}>
              <span className="dots-stack">{visibleEvents.slice(0, 4).map((e) => <span key={e.id} style={{ background: cals.paint(e).fg }} />)}</span>
              <span className="caption medium grow" style={{ textAlign: 'left' }}>{next ? `Próximo às ${hhmm(next.starts_at)} · ${next.title}` : visibleEvents.length ? `${visibleEvents.length} hoje, nada mais pela frente` : 'Nada na agenda hoje.'}</span>
            </button>
          )}

          <SectionHead title="Áreas da vida" action={<span className="mono muted">Execução</span>} />
          <div className="card flush list">
            {areas.filter((a) => !a.is_fixed).map((a) => {
              const v = exec.get(a.id) ?? null
              return (
                <Link key={a.id} to={`/ciclo/area/${a.id}`} className="list-row area-exec">
                  <AreaIcon area={a} size={28} />
                  <span className="grow">{a.name}</span>
                  <div className="bar" style={{ width: 96 }}><span style={{ width: `${v ?? 0}%`, background: `var(--${a.color}-bg)` }} /></div>
                  <span className="mono" style={{ width: 36, textAlign: 'right' }}>{v == null ? '–' : `${v}%`}</span>
                </Link>
              )
            })}
          </div>
          <p className="caption muted" style={{ margin: '-4px 0 0' }}>Passos da semana e hábitos de cada área, até hoje.</p>
        </div>
      </div>
    </div>
  )
}
