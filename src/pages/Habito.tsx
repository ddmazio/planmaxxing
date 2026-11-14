import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { insert, remove, update } from '../lib/db'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, todayYmd, ymd } from '../lib/dates'
import { EXEC_WEEKS, currentCycle } from '../lib/cycle'
import { execEnd } from '../lib/execution'
import type { Area, Cycle, Habit, HabitLog } from '../lib/types'
import { Empty, Sheet } from '../components/ui'
import { Icon } from '../components/Icon'

// segunda primeiro, como no Figma (S T Q Q S S D); valores = getDay()
const WEEK = [1, 2, 3, 4, 5, 6, 0]
const LETTER: Record<number, string> = { 0: 'D', 1: 'S', 2: 'T', 3: 'Q', 4: 'Q', 5: 'S', 6: 'S' }
const NAME: Record<number, string> = { 0: 'dom', 1: 'seg', 2: 'ter', 3: 'qua', 4: 'qui', 5: 'sex', 6: 'sáb' }

export function freqLabel(days: number[]) {
  if (days.length === 7) return 'Diário'
  if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))) return 'Dias úteis'
  if (days.length === 2 && days.includes(0) && days.includes(6)) return 'Fins de semana'
  return `${days.length}x por semana · ${WEEK.filter((d) => days.includes(d)).map((d) => NAME[d]).join(', ')}`
}

const mondayOf = (d: Date) => addDays(d, -((d.getDay() + 6) % 7))

/** Sequência: dias previstos seguidos com marca, de hoje para trás (hoje ainda sem marca não quebra). */
export function streakOf(h: Habit, done: Set<string>, today: string) {
  let n = 0
  let d = fromYmd(today)
  const start = h.created_at?.slice(0, 10) ?? '2000-01-01'
  for (let i = 0; i < 400; i++, d = addDays(d, -1)) {
    const k = ymd(d)
    if (k < start) break
    if (!h.days.includes(d.getDay())) continue
    if (done.has(k)) n++
    else if (k !== today) break
  }
  return n
}

export function Habito() {
  const { id } = useParams()
  const nav = useNavigate()
  const { rows: habits, loading } = useRows<Habit>('habits', { eq: { id: id ?? '' } }, !!id)
  const { rows: logs } = useRows<HabitLog>('habit_logs', { eq: { habit_id: id ?? '' } }, !!id)
  const { rows: cycles } = useRows<Cycle>('cycles', { order: { column: 'starts_on', ascending: false } })
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const [edit, setEdit] = useState(false)
  const h = habits[0]
  if (!h) return <div className="page"><p className="muted">{loading ? 'Carregando…' : 'Hábito não encontrado.'}</p><Link className="link" to="/ciclo">Voltar ao plano</Link></div>

  const today = todayYmd()
  const done = new Set(logs.map((l) => l.day))
  const cycle = currentCycle(cycles)
  // começa no que vier antes: a criação do hábito ou a primeira marca (dá para marcar dias passados)
  const firstLog = logs.reduce<string | null>((m, l) => (!m || l.day < m ? l.day : m), null)
  const createdAt = h.created_at?.slice(0, 10) ?? '2000-01-01'
  const created = firstLog && firstLog < createdAt ? firstLog : createdAt
  // período mostrado: o ciclo em curso; sem ciclo, as últimas 12 semanas
  const from = cycle ? cycle.starts_on : ymd(addDays(fromYmd(today), -7 * EXEC_WEEKS + 1))
  const to = cycle ? execEnd(cycle) : today
  const countFrom = from > created ? from : created
  let planned = 0, hit = 0
  for (let d = fromYmd(countFrom); ymd(d) <= today && ymd(d) <= to; d = addDays(d, 1)) {
    if (!h.days.includes(d.getDay())) continue
    planned++
    if (done.has(ymd(d))) hit++
  }
  const pct = planned ? Math.round((hit / planned) * 100) : null
  const streak = streakOf({ ...h, created_at: created }, done, today)
  const area = areas.find((a) => a.id === h.area_id)

  const weeks: Date[] = []
  for (let w = mondayOf(fromYmd(from)); ymd(w) <= to; w = addDays(w, 7)) weeks.push(w)

  const toggle = (day: string) => {
    const log = logs.find((l) => l.day === day)
    return log ? remove('habit_logs', log.id) : insert<HabitLog>('habit_logs', { habit_id: h.id, day })
  }
  const setDays = (d: number) => {
    const next = h.days.includes(d) ? h.days.filter((x) => x !== d) : [...h.days, d].sort()
    if (next.length) update<Habit>('habits', h.id, { days: next })
  }

  return (
    <div className="page">
      <div className="row between">
        <button className="row caption muted" style={{ gap: 4 }} onClick={() => (history.length > 1 ? nav(-1) : nav('/ciclo'))}><Icon name="back" size={16} />Plano</button>
        <button className="btn secondary small" onClick={() => setEdit(true)}>Editar</button>
      </div>

      <header className="stack" style={{ gap: 4 }}>
        <h1 className="h1">{h.title}</h1>
        <span className="mono muted" style={{ textTransform: 'uppercase' }}>{freqLabel(h.days)}{h.created_at ? ` · desde ${fmt(fromYmd(createdAt), 'd MMM')}` : ''}{area ? ` · ${area.name}` : ''}</span>
      </header>

      <div className="habit-stats">
        <div className="card stack" style={{ gap: 0 }}><span className="big">{streak}</span><span className="caption muted">dia{streak === 1 ? '' : 's'} seguido{streak === 1 ? '' : 's'}</span></div>
        <div className="card stack" style={{ gap: 0 }}><span className="big">{pct == null ? '–' : `${pct}%`}</span><span className="caption muted">{cycle ? 'no ciclo' : 'nas últimas 12 semanas'}</span></div>
        <div className="card stack" style={{ gap: 0 }}><span className="big">{hit}</span><span className="caption muted">de {planned} dia{planned === 1 ? '' : 's'}</span></div>
      </div>

      <div className="card stack">
        <span className="mono muted" style={{ textTransform: 'uppercase' }}>{cycle ? `${cycle.name} · ${EXEC_WEEKS} semanas` : 'Últimas 12 semanas'}</span>
        <div className="habit-cal" role="grid" aria-label="Calendário do hábito">
          <div className="hc-row" role="row">{WEEK.map((d, i) => <span key={i} className="mono faint hc-head" role="columnheader">{LETTER[d]}</span>)}</div>
          {weeks.map((w) => (
            <div key={ymd(w)} className="hc-row" role="row">
              {WEEK.map((_, i) => {
                const dt = addDays(w, i)
                const k = ymd(dt)
                const outside = k < from || k > to
                const due = h.days.includes(dt.getDay()) && k >= created
                const state = outside ? 'out' : done.has(k) ? 'done' : k === today ? 'today' : k > today ? 'future' : due ? 'miss' : 'off'
                const can = !outside && k <= today
                return (
                  <button key={k} role="gridcell" className={`hc-cell ${state}${k === today ? ' is-today' : ''}`} disabled={!can}
                    aria-label={`${fmt(dt, "EEEE, d 'de' MMMM")}: ${done.has(k) ? 'feito' : due ? 'não feito' : 'sem previsão'}`}
                    onClick={() => can && toggle(k)}>{!outside && dt.getDate()}</button>
                )
              })}
            </div>
          ))}
        </div>
        <div className="row caption muted" style={{ gap: 16, flexWrap: 'wrap' }}>
          <span className="row" style={{ gap: 6 }}><span className="hc-key done" />feito</span>
          <span className="row" style={{ gap: 6 }}><span className="hc-key miss" />não feito</span>
          <span className="row" style={{ gap: 6 }}><span className="hc-key is-today" />hoje</span>
        </div>
        <span className="caption faint">Toque num dia para marcar ou desmarcar.</span>
      </div>

      <div className="card stack">
        <span className="mono muted">Frequência</span>
        <div className="row" style={{ gap: 6 }}>
          {WEEK.map((d) => (
            <button key={d} className={'daypick' + (h.days.includes(d) ? ' on' : '')} aria-pressed={h.days.includes(d)} aria-label={NAME[d]} onClick={() => setDays(d)}>{LETTER[d]}</button>
          ))}
        </div>
        <label className="row between" style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
          <span>Lembrete</span>
          <input className="input" type="time" style={{ width: 120 }} defaultValue={h.reminder_time?.slice(0, 5) ?? ''}
            onBlur={(e) => (e.target.value || null) !== (h.reminder_time?.slice(0, 5) ?? null) && update<Habit>('habits', h.id, { reminder_time: e.target.value || null })} aria-label="Hora do lembrete" />
        </label>
        <span className="caption faint">O aviso no celular passa a chegar quando as notificações do app forem ligadas.</span>
      </div>

      {!logs.length && <Empty>Ainda sem marcas. Marque no Hoje ou toque no dia acima.</Empty>}

      <HabitSheet open={edit} onClose={() => setEdit(false)} habit={h} areas={areas} onArchived={() => nav('/ciclo')} />
    </div>
  )
}

function HabitSheet({ open, onClose, habit, areas, onArchived }: { open: boolean; onClose: () => void; habit: Habit; areas: Area[]; onArchived: () => void }) {
  const [title, setTitle] = useState(habit.title)
  const [area, setArea] = useState(habit.area_id ?? '')
  return (
    <Sheet open={open} onClose={onClose} title="Editar hábito">
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return; await update<Habit>('habits', habit.id, { title: title.trim(), area_id: area || null }); onClose() }}>
        <label className="field"><span>Nome</span><input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Área</span>
          <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Sem área</option>
            {areas.filter((a) => !a.is_fixed).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
        <button className="btn primary block">Guardar</button>
        <button type="button" className="btn ghost block" onClick={async () => { await update<Habit>('habits', habit.id, { archived: true }); onClose(); onArchived() }}>Arquivar hábito</button>
        <span className="caption faint" style={{ textAlign: 'center' }}>Arquivar tira o hábito do Hoje e do plano. As marcas ficam guardadas.</span>
      </form>
    </Sheet>
  )
}
