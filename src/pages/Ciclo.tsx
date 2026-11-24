import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom'
import { insert, remove, removeWhere, update } from '../lib/db'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, toIso, todayYmd, weekStart, ymd } from '../lib/dates'
import { execWeeks, totalWeeks, currentCycle, daysUntil, score, scoreLabel, weekOf, weekRange } from '../lib/cycle'
import type { Area, CalEvent, Cycle, Goal, Habit, HabitLog, List, Reflection, Step, Task } from '../lib/types'
import { TaskRow } from '../components/TaskRow'
import { GoalWizard } from '../components/GoalWizard'
import { otherAreas } from '../lib/areas'
import { AreaIcon, AreaTag, Check, Empty, SectionHead, Sheet } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader, type ShellCtx } from '../components/Shell'
import { useRitualDraft } from '../lib/ritual'
import { RitualResume } from '../components/RitualResume'

// ---------------------------------------------------------------- dados do ciclo atual
export function useCycle() {
  const { rows: cycles, loading } = useRows<Cycle>('cycles', { order: { column: 'starts_on', ascending: false } })
  const cycle = currentCycle(cycles)
  const { rows: goals } = useRows<Goal>('goals', cycle ? { eq: { cycle_id: cycle.id }, order: { column: 'position' } } : undefined, !!cycle)
  const { rows: allSteps } = useRows<Step>('steps', { order: { column: 'position' } }, !!cycle)
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const steps = useMemo(() => {
    const ids = new Set(goals.map((g) => g.id))
    return allSteps.filter((s) => ids.has(s.goal_id))
  }, [goals, allSteps])
  return { cycles, cycle, goals: cycle ? goals : [], steps: cycle ? steps : [], areas, loading }
}

const toggleStep = (s: Step) => update<Step>('steps', s.id, { done_at: s.done_at ? null : new Date().toISOString() })

const splitList = (s: string) => s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean)
/** Who is she: uma frase por linha (vírgula faz parte da frase). */
const splitLines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

// ---------------------------------------------------------------- página /ciclo
export function Ciclo() {
  const data = useCycle()
  if (data.loading) return <div className="page"><p className="muted">Carregando…</p></div>
  return data.cycle ? <CicloAtivo data={data} cycle={data.cycle} /> : <NovoCiclo />
}

// ---------------------------------------------------------------- sem ciclo: o novo ciclo começa pelo ritual
function NovoCiclo() {
  const { cycles } = useCycle()
  const going = useRitualDraft()
  const last = cycles.find((c) => c.status === 'closed')
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <PageHeader eyebrow={last ? `Último ciclo: ${last.name}` : 'Sem ciclo em curso'} title="Novo ciclo" />
      <div className="card stack" style={{ gap: 12 }}>
        <span className="serif" style={{ fontSize: 26, lineHeight: '30px' }}>{going ? 'Seu ritual de novo ciclo está guardado.' : 'Um ciclo novo começa pelo ritual.'}</span>
        {going && <span className="tag-pill lime" style={{ alignSelf: 'flex-start' }}>{going.part ? `parte ${going.part} de 3 · ` : ''}parou em {going.name}</span>}
        <p className="muted" style={{ margin: 0 }}>Você olha cada área, escolhe as de foco e o que quer TER no fim, define recompensas, 3 palavras, metas e projetos. No fim o app distribui tudo pelas semanas.</p>
        <Link className="btn primary" style={{ alignSelf: 'flex-start' }} to="/ciclo/trimestre"><Icon name="sparkle" size={16} />{going ? 'Continuar o ritual' : 'Começar o ritual'}</Link>
        <span className="caption muted">Dá para pausar a qualquer momento. O app guarda onde você parou.</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- ciclo em curso
function CicloAtivo({ data, cycle }: { data: ReturnType<typeof useCycle>; cycle: Cycle }) {
  const { goals, steps, areas } = data
  const now = weekOf(cycle)
  const EXEC_WEEKS = execWeeks(cycle), TOTAL_WEEKS = totalWeeks(cycle)
  const execNow = Math.min(Math.max(now, 1), EXEC_WEEKS)
  const [week, setWeek] = useState(execNow)
  const [newGoal, setNewGoal] = useState(false)
  const [editVision, setEditVision] = useState(false)
  const nav = useNavigate()
  const { rows: reflections } = useRows<Reflection>('reflections', { eq: { cycle_id: cycle.id }, order: { column: 'week', ascending: false } })
  const { rows: habits } = useRows<Habit>('habits', { eq: { archived: false } })

  const weekSteps = steps.filter((s) => s.week === week)
  const pastSteps = steps.filter((s) => s.week < execNow)
  const ended = now > TOTAL_WEEKS
  const goalOf = (id: string) => goals.find((g) => g.id === id)
  const areaOf = (id: string | null) => areas.find((a) => a.id === id)
  const others = otherAreas(areas)
  const reviewedNow = reflections.some((r) => r.kind === 'review' && r.week === now)

  const [deleting, setDeleting] = useState(false)
  async function destroy() {
    // reflexões ficariam soltas (o banco só desliga o ciclo delas), então saem primeiro; metas e passos saem junto com o ciclo
    await removeWhere('reflections', { cycle_id: cycle.id })
    await remove('cycles', cycle.id)
    setDeleting(false)
  }

  async function close() {
    if (!confirm('Encerrar este ciclo? Ele fica guardado e você pode começar outro.')) return
    await update<Cycle>('cycles', cycle.id, { status: 'closed' })
  }

  return (
    <div className="page wide">
      <PageHeader eyebrow={`${cycle.name} · ${
        now === 0 ? `começa em ${daysUntil(cycle)} dia${daysUntil(cycle) === 1 ? '' : 's'}`
          : ended ? 'terminado'
          : now === TOTAL_WEEKS ? 'semana de revisão'
          : `semana ${now} de ${EXEC_WEEKS}`}`} title="Plano do ciclo"
        right={<div className="row" style={{ gap: 8 }}><Link className="btn secondary small" to="/grupo"><Icon name="users" size={16} />Grupo</Link><Link className="btn primary small" to="/ciclo/ritual"><Icon name="sparkle" size={16} />Ritual da semana</Link></div>} />
      <RitualResume />

      <div className="plan-stats">
        <div><span className="big">{goals.length}</span><span className="caption muted">meta{goals.length === 1 ? '' : 's'}</span></div>
        <div><span className="big">{steps.length}</span><span className="caption muted">passo{steps.length === 1 ? '' : 's'}</span></div>
        <div><span className="big">{habits.length}</span><span className="caption muted">hábito{habits.length === 1 ? '' : 's'}</span></div>
      </div>

      <div className="weeks" style={{ gridTemplateColumns: `repeat(${TOTAL_WEEKS}, 1fr)` }} aria-label={`Semana ${now} de ${TOTAL_WEEKS}`}>
        {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((w) => (
          <span key={w} className={w === now ? 'now' : w < now ? 'past' : w === TOTAL_WEEKS ? 'review' : ''} title={`Semana ${w}`} />
        ))}
      </div>

      {(ended || now >= EXEC_WEEKS) && (
        <Link to="/ciclo/trimestre" className="card lime row between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="stack" style={{ gap: 2 }}><span className="medium">{ended ? `As ${TOTAL_WEEKS} semanas acabaram.` : now === TOTAL_WEEKS ? 'É a semana de revisão: hora do ritual.' : 'O ciclo está acabando.'}</span>
            <span className="caption">Olhar para trás, decidir e organizar o próximo ciclo · 3 partes, no seu ritmo.</span></div>
          <span className="btn primary small">Fazer o ritual do trimestre</span>
        </Link>
      )}
      {!ended && now >= 1 && now < TOTAL_WEEKS && !reviewedNow && (
        <Link to="/ciclo/ritual" className="banner row between"><span>Ainda não fez o ritual desta semana. Leva uns 10 minutos.</span><Icon name="chevron" size={16} /></Link>
      )}

      <div className="grid2">
        <div className="stack">
          <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <ScoreCard label="Esta semana" value={score(steps.filter((s) => s.week === execNow))} />
            <ScoreCard label="Até agora" value={score(pastSteps)} hint={pastSteps.length ? `${pastSteps.filter((s) => s.done_at).length} de ${pastSteps.length} passos` : 'conta a partir da semana 2'} />
          </div>

          <SectionHead title="Passos da semana" action={
            <div className="row" style={{ gap: 4 }}>
              <button className="icon-btn" aria-label="Semana anterior" disabled={week <= 1} onClick={() => setWeek(week - 1)}><Icon name="back" size={16} /></button>
              <span className="caption" style={{ minWidth: 72, textAlign: 'center' }}>Semana {week}</span>
              <button className="icon-btn" aria-label="Próxima semana" disabled={week >= EXEC_WEEKS} onClick={() => setWeek(week + 1)}><Icon name="chevron" size={16} /></button>
            </div>} />
          <p className="caption muted" style={{ margin: '-6px 0 0' }}>{weekRange(cycle, week)}</p>
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
                    <AreaTag area={areaOf(g?.area_id ?? null)} />
                  </div>
                )
              })}
            </div>
          ) : <Empty>{goals.length ? 'Nenhum passo nesta semana. Abra uma meta e adicione passos.' : 'Crie uma meta para começar.'}</Empty>}

        </div>

        <div className="stack">
          <SectionHead title="Metas" action={<button className="btn secondary small" onClick={() => setNewGoal(true)}><Icon name="plus" size={14} />Meta</button>} />
          {goals.length ? goals.map((g) => <GoalCard key={g.id} goal={g} steps={steps.filter((s) => s.goal_id === g.id)} area={areaOf(g.area_id)} current={execNow} weeks={EXEC_WEEKS} />)
            : <Empty>Sem metas ainda. Escolha 1 a 3 para este ciclo.</Empty>}

          <SectionHead title="Hábitos" action={<span className="caption muted">abra para ver o calendário</span>} />
          {habits.length ? (
            <div className="card flush list">
              {habits.map((h) => (
                <Link key={h.id} to={`/habito/${h.id}`} className="list-row">
                  <span className="grow">{h.title}</span><AreaTag area={areaOf(h.area_id)} /><Icon name="chevron" size={16} className="faint" />
                </Link>
              ))}
            </div>
          ) : <Empty>Sem hábitos. Escreva no + algo como “ler 20 min todo dia”.</Empty>}

          <SectionHead title="Quem você está se tornando" action={<button className="caption muted" onClick={() => setEditVision(true)}>editar</button>} />
          {cycle.words.length || cycle.who_is_she.length ? (
            <div className="card soft stack">
              {cycle.words.length > 0 && <div className="wordchips">{cycle.words.map((w) => <span key={w}>{w}</span>)}</div>}
              {cycle.who_is_she.map((w) => <span key={w}>· {w}</span>)}
            </div>
          ) : <Empty>Escreva as palavras do ciclo e quem você quer ser no fim dele.</Empty>}

          {(cycle.rewards?.length ?? 0) > 0 && <>
            <SectionHead title="Recompensas" />
            <div className="card flush list">
              {cycle.rewards!.map((r, i) => <div key={i} className="list-row"><Icon name="gift" size={16} className="faint" /><span className="grow">{r.t}</span><AreaTag area={areaOf(r.area)} /></div>)}
            </div>
          </>}
          {(cycle.ideas?.length ?? 0) > 0 && <>
            <SectionHead title="Ideias para o ciclo" action={<span className="caption muted">prêmios para as semanas boas</span>} />
            <div className="card soft wordchips">{cycle.ideas!.map((x) => <span key={x}>{x}</span>)}</div>
          </>}
          {others.length > 0 && (
            <details className="card others">
              <summary className="row between"><span className="medium">Outras áreas · {others.length}</span><span className="caption muted">sem metas neste ciclo</span></summary>
              <div className="list" style={{ marginTop: 8 }}>
                {others.map((a) => <Link key={a.id} to={`/ciclo/area/${a.id}`} className="list-row"><AreaIcon area={a} size={24} /><span className="grow">{a.name}</span>{a.score_now != null && <span className="caption muted mono">{Number(a.score_now)}/10</span>}<Icon name="chevron" size={16} className="faint" /></Link>)}
              </div>
            </details>
          )}

          <SectionHead title="Reflexões" action={<Link className="caption muted" to="/reflexoes">todas →</Link>} />
          {reflections.length ? (
            <div className="card flush list">
              {reflections.map((r) => (
                <button key={r.id} className="list-row" onClick={() => nav(`/ciclo/ritual?semana=${r.week}`)}>
                  <span className="step-no">S{r.week}</span>
                  <span className="grow">{r.answers[2] || r.answers[0] || 'Ritual da semana'}</span>
                  {r.score != null && <span className="caption muted">{r.score}%</span>}
                </button>
              ))}
            </div>
          ) : <Empty>Cada ritual semanal fica guardado aqui.</Empty>}

          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <Link className="btn ghost small" to="/ciclo/trimestre"><Icon name="sparkle" size={14} />Ritual de novo ciclo</Link>
            {!ended && <button className="btn ghost small" onClick={close}>Encerrar ciclo antes do fim</button>}
            {ended && <button className="btn ghost small" onClick={close}>Encerrar sem o ritual</button>}
            <button className="btn ghost small" style={{ color: 'var(--danger)' }} onClick={() => setDeleting(true)}><Icon name="trash" size={14} />Apagar ciclo e recomeçar</button>
          </div>
        </div>
      </div>

      <GoalSheet open={newGoal} onClose={() => setNewGoal(false)} cycle={cycle} areas={areas} position={goals.length} />
      <Sheet open={deleting} onClose={() => setDeleting(false)} title="Apagar ciclo" labelledBy="del-cycle">
        <p style={{ margin: 0 }}>Apagar <b>{cycle.name}</b> com {goals.length} meta{goals.length === 1 ? '' : 's'}, {steps.length} passo{steps.length === 1 ? '' : 's'} e {reflections.length} reflex{reflections.length === 1 ? 'ão' : 'ões'}?</p>
        <p className="caption muted" style={{ margin: 0 }}>Não há volta. Suas áreas, tarefas, agenda e finanças não mudam. Se quiser guardar o histórico, use “Encerrar ciclo” em vez de apagar.</p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary grow" onClick={() => setDeleting(false)}>Cancelar</button>
          <button className="btn danger grow" onClick={destroy}>Apagar e recomeçar</button>
        </div>
      </Sheet>
      <VisionSheet open={editVision} onClose={() => setEditVision(false)} cycle={cycle} />
    </div>
  )
}

function ScoreCard({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  return (
    <div className={'card stack' + (value != null && value >= 85 ? ' lime' : '')} style={{ gap: 6 }}>
      <span className="mono" style={{ opacity: 0.7 }}>{label}</span>
      <span className="big" style={{ fontSize: 40 }}>{value == null ? '–' : `${value}%`}</span>
      <span className="caption" style={{ opacity: 0.75 }}>{hint ?? scoreLabel(value)}</span>
    </div>
  )
}

function GoalCard({ goal, steps, area, current, weeks }: { goal: Goal; steps: Step[]; area?: Area; current: number; weeks: number }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [week, setWeek] = useState(current)
  const done = steps.filter((s) => s.done_at).length
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <button className="row" style={{ alignItems: 'flex-start', textAlign: 'left' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="grow stack" style={{ gap: 4 }}>
          <span className="h3">{goal.title}</span>
          {goal.done_definition && <span className="caption muted">{/^TER /.test(goal.done_definition) ? goal.done_definition : `Pronto quando: ${goal.done_definition}`}</span>}
        </div>
        <AreaTag area={area} />
      </button>
      <div className="row"><div className="bar grow"><span style={{ width: `${pct}%` }} /></div><span className="caption muted">{done} de {steps.length}</span></div>

      {open && (
        <div className="stack" style={{ gap: 8 }}>
          {steps.length > 0 && (
            <div className="list">
              {[...steps].sort((a, b) => a.week - b.week || a.position - b.position).map((s) => (
                <div key={s.id} className="list-row" style={{ minHeight: 40, padding: '8px 0' }}>
                  <span className="step-no">S{s.week}</span>
                  <Check done={!!s.done_at} onToggle={() => toggleStep(s)} label={`Concluir ${s.title}`} />
                  <span className={'grow' + (s.done_at ? ' done-text' : '')}>{s.title}</span>
                  <button aria-label="Apagar passo" className="faint" onClick={() => remove('steps', s.id)}><Icon name="x" size={16} /></button>
                </div>
              ))}
            </div>
          )}
          <form className="row" style={{ gap: 8 }} onSubmit={async (e) => { e.preventDefault(); const t = title.trim(); if (!t) return; setTitle(''); await insert<Step>('steps', { goal_id: goal.id, title: t, week, position: steps.length }) }}>
            <input className="input grow" placeholder="Novo passo" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="Novo passo" />
            <select className="input" style={{ width: 88 }} value={week} onChange={(e) => setWeek(Number(e.target.value))} aria-label="Semana">
              {Array.from({ length: weeks }, (_, i) => i + 1).map((w) => <option key={w} value={w}>S{w}</option>)}
            </select>
            <button className="icon-btn ink" aria-label="Adicionar passo" disabled={!title.trim()}><Icon name="plus" size={18} /></button>
          </form>
          <button className="btn ghost small" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }}
            onClick={() => { if (confirm('Apagar esta meta e os passos dela?')) remove('goals', goal.id) }}><Icon name="trash" size={14} />Apagar meta</button>
        </div>
      )}
    </div>
  )
}

function GoalSheet({ open, onClose, cycle, areas, position, areaId }: { open: boolean; onClose: () => void; cycle: Cycle; areas: Area[]; position: number; areaId?: string }) {
  const { rows: allSteps } = useRows<Step>('steps')
  const { rows: cg } = useRows<Goal>('goals', { eq: { cycle_id: cycle.id } })
  const steps = allSteps.filter((s) => cg.some((g) => g.id === s.goal_id))
  const { rows: refl } = useRows<Reflection>('reflections', { eq: { kind: 'reset' } })
  if (!open) return null
  // inspiração: as melhorias que você escreveu no ritual do trimestre
  const insp = (() => { try { const st = JSON.parse(refl.find((r) => r.prompt === 'ritual-trimestre')?.answers[0] ?? '{}'); return [...Object.values(st.improve ?? {}).flat(), ...Object.values((st.refl ?? {}) as Record<string, { improve?: string[] }>).flatMap((r) => r.improve ?? [])].filter(Boolean) as string[] } catch { return [] } })()
  const now = weekOf(cycle)
  return <GoalWizard cycleId={cycle.id} areas={areas} existing={steps} position={position} areaId={areaId} inspiration={insp} current={Math.min(Math.max(now, 1), execWeeks(cycle))} weeks={execWeeks(cycle)} onDone={onClose} onCancel={onClose} />
}

function VisionSheet({ open, onClose, cycle }: { open: boolean; onClose: () => void; cycle: Cycle }) {
  const [words, setWords] = useState(cycle.words.join(', '))
  const [who, setWho] = useState(cycle.who_is_she.join('\n'))
  const [name, setName] = useState(cycle.name)
  return (
    <Sheet open={open} onClose={onClose} title="Visão do ciclo" labelledBy="vision-sheet">
      <form className="stack" onSubmit={async (e) => { e.preventDefault()
        await update<Cycle>('cycles', cycle.id, { name: name.trim() || cycle.name, words: splitList(words).slice(0, 10), who_is_she: splitLines(who).slice(0, 20) }); onClose() }}>
        <label className="field"><span>Nome do ciclo</span><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Palavras (separe por vírgula)</span><input className="input" value={words} maxLength={300} onChange={(e) => setWords(e.target.value)} /></label>
        <label className="field"><span>Quem você quer ser (uma frase por linha)</span><textarea className="input" rows={5} value={who} maxLength={2000} onChange={(e) => setWho(e.target.value)} /></label>
        <button className="btn primary">Guardar</button>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------- ritual semanal em 3 partes
// ---------------------------------------------------------------- página de uma área
export function AreaPage() {
  const { id } = useParams()
  const { openQuick } = useOutletContext<ShellCtx>()
  const { cycle, goals, steps, areas, loading } = useCycle()
  const today = todayYmd()
  const now = new Date()
  const weekAgo = ymd(addDays(now, -6))
  const ws = weekStart(now)
  const { rows: habits } = useRows<Habit>('habits', { eq: { area_id: id ?? '', archived: false } }, !!id)
  const { rows: logs } = useRows<HabitLog>('habit_logs', { gte: { day: weekAgo } })
  const { rows: tasks } = useRows<Task>('tasks', { eq: { area_id: id ?? '', completed_at: null } }, !!id)
  const { rows: lists } = useRows<List>('lists')
  const { rows: events } = useRows<CalEvent>('events', { eq: { area_id: id ?? '' }, gte: { starts_at: toIso(ymd(ws)) }, lt: { starts_at: toIso(ymd(addDays(ws, 7))) }, order: { column: 'starts_at' } }, !!id)
  const [newGoal, setNewGoal] = useState(false)
  const [editing, setEditing] = useState(false)
  const [habit, setHabit] = useState('')
  const [task, setTask] = useState('')
  const [step, setStep] = useState('')
  const area = areas.find((a) => a.id === id)
  if (!area) return <div className="page"><p className="muted">{loading ? 'Carregando…' : 'Área não encontrada.'}</p></div>
  const areaGoals = goals.filter((g) => g.area_id === area.id)
  const focus = areaGoals.length > 0
  const current = cycle ? Math.min(Math.max(weekOf(cycle), 1), execWeeks(cycle)) : 1
  const inExec = !!cycle && weekOf(cycle) >= 1 && weekOf(cycle) <= execWeeks(cycle)
  const goalIds = new Set(areaGoals.map((g) => g.id))
  const weekSteps = inExec ? steps.filter((s) => goalIds.has(s.goal_id) && s.week === current) : []
  const last7 = Array.from({ length: 7 }, (_, i) => ymd(addDays(now, i - 6)))
  const fmtScore = (v: number | null) => (v == null ? '–' : String(Number(v)))
  const doneDay = (d: string | null) => (d ? fmt(new Date(d), 'EEE') : '')

  const addStep = async (e: React.FormEvent) => {
    e.preventDefault(); const t = step.trim(); if (!t || !areaGoals[0]) return; setStep('')
    await insert<Step>('steps', { goal_id: areaGoals[0].id, title: t, week: current, position: steps.length })
  }
  const addTask = async (e: React.FormEvent) => {
    e.preventDefault(); const t = task.trim(); if (!t) return; setTask('')
    await insert<Task>('tasks', { title: t, area_id: area.id, list_id: null, important: false, position: 0 })
  }
  const addHabit = async (e: React.FormEvent) => {
    e.preventDefault(); const t = habit.trim(); if (!t) return; setHabit('')
    await insert<Habit>('habits', { title: t, area_id: area.id, days: [0, 1, 2, 3, 4, 5, 6], archived: false })
  }

  return (
    <div className="page wide" key={area.id}>
      <header className="card stack" style={{ background: `var(--${area.color}-bg)`, color: `var(--${area.color}-fg)`, gap: 8 }}>
        <div className="row between" style={{ alignItems: 'flex-start', flexWrap: 'wrap', rowGap: 12 }}>
          <div className="stack" style={{ gap: 4 }}>
            <span className="mono" style={{ textTransform: 'uppercase' }}>Área da vida · {area.is_fixed ? 'sempre ligada' : focus ? 'foco neste ciclo' : 'manutenção'}</span>
            <h1 className="h1 row" style={{ gap: 12 }}><AreaIcon area={area} size={40} />{area.name}</h1>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="area-score" onClick={() => setEditing(true)} aria-label="Editar notas da área">
              <div><span className="big">{fmtScore(area.score_now)}</span><span className="caption">hoje</span></div>
              <div><span className="big">{fmtScore(area.score_goal)}</span><span className="caption">quero</span></div>
            </button>
          </div>
        </div>
      </header>

      <div className="grid2">
        <div className="stack">
          {!cycle ? <Empty>Sem ciclo em curso. <Link className="link" to="/ciclo">Criar ciclo</Link></Empty>
            : focus ? areaGoals.map((g) => {
              const gs = steps.filter((s) => s.goal_id === g.id)
              const done = gs.filter((s) => s.done_at).length
              const pct = gs.length ? Math.round((done / gs.length) * 100) : 0
              return (
                <div key={g.id} className="card ink stack" style={{ gap: 10 }}>
                  <span className="mono" style={{ opacity: 0.6 }}>META DO CICLO</span>
                  <span className="h3">{g.title}</span>
                  {g.done_definition && <span className="caption" style={{ opacity: 0.7 }}>{g.done_definition}</span>}
                  <div className="row between caption"><span style={{ opacity: 0.7 }}>{done} de {gs.length} passo{gs.length === 1 ? '' : 's'}</span><span className="medium">{pct}%</span></div>
                  <div className="bar on-ink"><span style={{ width: `${pct}%` }} /></div>
                </div>
              )
            }) : (
              <div className="card soft stack" style={{ gap: 6 }}>
                <span className="mono muted">EM MANUTENÇÃO NESTE CICLO</span>
                <span>Sem meta agora. Os hábitos seguram a área.</span>
                {!area.is_fixed && <button className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => setNewGoal(true)}><Icon name="plus" size={14} />Criar uma meta</button>}
              </div>
            )}
          {focus && <button className="caption muted" style={{ alignSelf: 'flex-start' }} onClick={() => setNewGoal(true)}>+ outra meta nesta área</button>}
        </div>

        <div className="stack">
          <button className="card stack" style={{ textAlign: 'left', gap: 6 }} onClick={() => setEditing(true)}>
            <span className="mono muted">{area.focus ? 'NO FIM DO CICLO EU QUERO TER' : 'POR QUE IMPORTA'}</span>
            {area.why ? <span className="serif" style={{ fontSize: 22, lineHeight: '28px' }}>“{area.why}”</span> : <span className="muted">{area.focus ? 'O que você quer ter no fim do ciclo nesta área?' : 'Escreva por que esta área importa para você.'}</span>}
          </button>
          <button className="card stack" style={{ textAlign: 'left', gap: 6 }} onClick={() => setEditing(true)}>
            <span className="mono muted">O QUE QUERO MELHORAR</span>
            {area.improve ? <span>{area.improve}</span> : <span className="muted">O que você quer mudar nesta área?</span>}
          </button>
        </div>
      </div>

      <div className="area-cols">
        {/* passos da semana (área em foco) ou agenda da semana (manutenção) */}
        {focus ? (
          <section className="stack">
            <div className="col-head"><span className="h3">Passos desta semana</span><span className="count">{weekSteps.length}</span></div>
            <div className="card flush list">
              {weekSteps.map((s) => (
                <div key={s.id} className="list-row">
                  <Check done={!!s.done_at} onToggle={() => toggleStep(s)} label={s.done_at ? `Desmarcar ${s.title}` : `Concluir ${s.title}`} />
                  <div className="grow stack" style={{ gap: 2 }}>
                    <span className={s.done_at ? 'done-text' : ''}>{s.title}</span>
                    {(s.done_at || s.detail) && <span className="caption muted">{s.done_at ? `feito ${doneDay(s.done_at)}` : s.detail}</span>}
                  </div>
                </div>
              ))}
              {inExec && <form className="list-row" onSubmit={addStep}><Icon name="plus" size={18} className="faint" />
                <input className="input bare grow" placeholder="Adicionar" value={step} maxLength={200} onChange={(e) => setStep(e.target.value)} aria-label="Novo passo desta semana" /></form>}
            </div>
          </section>
        ) : (
          <section className="stack">
            <div className="col-head"><span className="h3">Na agenda esta semana</span><span className="count">{events.length}</span></div>
            <div className="card flush list">
              {events.map((e) => (
                <Link key={e.id} to={`/agenda?evento=${e.id}`} className="list-row">
                  <div className="grow stack" style={{ gap: 2 }}><span>{e.title}</span>
                    <span className="caption muted">{fmt(new Date(e.starts_at), e.all_day ? 'EEEE' : "EEEE HH'h'mm").replace(/h00$/, 'h')}</span></div>
                </Link>
              ))}
              <Link className="list-row muted" to={`/agenda?novo=${today}`}><Icon name="plus" size={18} />Adicionar</Link>
            </div>
          </section>
        )}

        <section className="stack">
          <div className="col-head"><span className="h3">Tarefas</span><span className="count">{tasks.length}</span></div>
          <div className="card flush list">
            {tasks.length === 0 && <div className="list-row caption muted">Nada por enquanto.</div>}
            {tasks.map((t) => <TaskRow key={t.id} task={t} lists={lists} areas={[]} />)}
            <form className="list-row" onSubmit={addTask}><Icon name="plus" size={18} className="faint" />
              <input className="input bare grow" placeholder="Adicionar" value={task} maxLength={500} onChange={(e) => setTask(e.target.value)} aria-label="Nova tarefa desta área" /></form>
          </div>
        </section>

        <section className="stack">
          <div className="col-head"><span className="h3">Hábitos</span><span className="count">{habits.length}</span></div>
          <div className="card flush list">
            {habits.length === 0 && <div className="list-row caption muted">Nenhum hábito aqui ainda. Hábitos pequenos ajudam a meta a andar sozinha.</div>}
            {habits.map((h) => {
              const due = last7.filter((d) => h.days.includes(fromYmd(d).getDay()))
              const hit = logs.filter((l) => l.habit_id === h.id && due.includes(l.day)).length
              return (
                <Link key={h.id} to={`/habito/${h.id}`} className="list-row">
                  <div className="grow stack" style={{ gap: 2 }}><span>{h.title}</span><span className="caption muted">{hit} de {due.length} dias</span></div>
                  <Icon name="chevron" size={16} className="faint" />
                </Link>
              )
            })}
            <form className="list-row" onSubmit={addHabit}><Icon name="plus" size={18} className="faint" />
              <input className="input bare grow" placeholder="Adicionar" value={habit} maxLength={120} onChange={(e) => setHabit(e.target.value)} aria-label="Novo hábito" /></form>
          </div>
        </section>
      </div>
      <button className="caption muted" style={{ alignSelf: 'flex-start' }} onClick={openQuick}>Ou use o + para escrever do seu jeito</button>

      <Sheet open={editing} onClose={() => setEditing(false)} title={area.name}>
        <AreaEdit area={area} onDone={() => setEditing(false)} />
      </Sheet>
      {cycle && <GoalSheet open={newGoal} onClose={() => setNewGoal(false)} cycle={cycle} areas={areas} position={goals.length} areaId={area.id} />}
    </div>
  )
}

function AreaEdit({ area, onDone }: { area: Area; onDone: () => void }) {
  const set = (patch: Partial<Area>) => update<Area>('areas', area.id, patch)
  const [why, setWhy] = useState(area.why ?? '')
  const [improve, setImprove] = useState(area.improve ?? '')
  return (
    <form className="stack" onSubmit={async (e) => { e.preventDefault(); await set({ why: why.trim() || null, improve: improve.trim() || null }); onDone() }}>
      <span className="mono muted">Nota de 0 a 10</span>
      <ScoreSlider label="Hoje" value={area.score_now} onChange={(v) => set({ score_now: v })} />
      <ScoreSlider label="Onde quero chegar" value={area.score_goal} onChange={(v) => set({ score_goal: v })} />
      <label className="field"><span>{area.focus ? 'No fim do ciclo eu quero TER…' : 'Por que esta área importa'}</span><textarea className="input" rows={3} maxLength={2000} value={why} onChange={(e) => setWhy(e.target.value)} /></label>
      <label className="field"><span>O que quero melhorar</span><textarea className="input" rows={3} maxLength={2000} value={improve} onChange={(e) => setImprove(e.target.value)} /></label>
      <button className="btn primary block">Guardar</button>
    </form>
  )
}

function ScoreSlider({ label, value, onChange }: { label: string; value: number | null; onChange: (v: number) => void }) {
  const [v, setV] = useState(value ?? 5)
  return (
    <label className="stack" style={{ gap: 4 }}>
      <span className="row between caption"><span className="muted">{label}</span><span className="medium">{value == null ? 'sem nota' : `${v}/10`}</span></span>
      <input type="range" min={0} max={10} step={1} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => onChange(v)} onKeyUp={() => onChange(v)} onBlur={() => v !== value && onChange(v)} />
    </label>
  )
}

/** Passos desta semana, para o Hoje. */
export function useWeekSteps() {
  const { cycle, goals, steps, areas } = useCycle()
  if (!cycle) return { cycle: null, week: 0, items: [] as { step: Step; goal?: Goal; area?: Area }[] }
  const week = weekOf(cycle)
  const items = steps.filter((s) => s.week === week).map((step) => {
    const goal = goals.find((g) => g.id === step.goal_id)
    return { step, goal, area: areas.find((a) => a.id === goal?.area_id) }
  })
  return { cycle, week, items, toggle: toggleStep, today: todayYmd() }
}
