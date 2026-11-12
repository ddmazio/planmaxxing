import { useMemo, useState } from 'react'
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom'
import { insert, remove, removeWhere, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { fmt, fromYmd, todayYmd, weekStart, ymd } from '../lib/dates'
import { EXEC_WEEKS, TOTAL_WEEKS, currentCycle, daysUntil, newCycleDates, score, scoreLabel, weekOf, weekRange } from '../lib/cycle'
import type { Area, Cycle, Goal, Habit, Reflection, Step } from '../lib/types'
import { AreaTag, Check, Empty, SectionHead, Sheet, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader, type ShellCtx } from '../components/Shell'

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

// ---------------------------------------------------------------- página /ciclo
export function Ciclo() {
  const data = useCycle()
  if (data.loading) return <div className="page"><p className="muted">Carregando…</p></div>
  return data.cycle ? <CicloAtivo data={data} cycle={data.cycle} /> : <NovoCiclo />
}

// ---------------------------------------------------------------- criar ciclo (3 passos)
function NovoCiclo() {
  const { profile } = useAuth()
  const { cycles, areas } = useCycle()
  const { toast } = useOutletContext<ShellCtx>()
  const [step, setStep] = useState(0)
  const [name, setName] = useState(`Ciclo ${cycles.length + 1}`)
  const [start, setStart] = useState(ymd(weekStart(new Date(), profile?.week_starts_on ?? 1)))
  const [words, setWords] = useState('')
  const [who, setWho] = useState('')
  const [goals, setGoals] = useState<{ area_id: string | null; title: string; done_definition: string }[]>([])
  const [draft, setDraft] = useState({ area_id: '', title: '', done_definition: '' })
  const [busy, setBusy] = useState(false)
  const focus = areas.filter((a) => a.focus && !a.is_fixed)
  const dates = newCycleDates(start)

  async function create() {
    setBusy(true)
    try {
      const c = await insert<Cycle>('cycles', { name: name.trim(), ...dates, status: 'active', words: splitList(words).slice(0, 10), who_is_she: splitList(who).slice(0, 20) })
      for (const [i, g] of goals.entries()) await insert<Goal>('goals', { cycle_id: c.id, area_id: g.area_id, title: g.title, done_definition: g.done_definition || null, kind: 'project', position: i })
      toast('Ciclo criado. Agora quebre cada meta em passos.')
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Não deu para criar o ciclo')
      setBusy(false)
    }
  }

  const steps = ['Quando', 'Quem você quer ser', 'Metas']
  return (
    <div className="page">
      <PageHeader eyebrow={`Novo ciclo · ${step + 1} de 3`} title={steps[step]} />
      <div className="row" style={{ gap: 4 }}>{steps.map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? 'var(--ink)' : 'var(--border)' }} />)}</div>

      {step === 0 && (
        <div className="stack">
          <div className="card soft caption">Um ciclo tem 12 semanas para fazer acontecer e 1 semana para olhar para trás. Um ano cabe em 12 semanas: sem prazo distante, cada semana conta.</div>
          <label className="field"><span>Nome do ciclo</span><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Começa em</span><input type="date" className="input" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></label>
          <p className="caption muted" style={{ margin: 0 }}>Termina em {fmt(fromYmd(dates.ends_on), "d 'de' MMMM 'de' yyyy")}, com a semana 13 para revisão.</p>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!name.trim()} onClick={() => setStep(1)}>Continuar</button>
        </div>
      )}

      {step === 1 && (
        <div className="stack">
          <label className="field"><span>Palavras do ciclo (separe por vírgula)</span>
            <input className="input" placeholder="calma, foco, coragem" value={words} maxLength={300} onChange={(e) => setWords(e.target.value)} /></label>
          <label className="field"><span>Quem é a pessoa que termina este ciclo? Uma frase por linha</span>
            <textarea className="input" rows={5} placeholder={'Acorda cedo sem esforço\nTermina o que começa'} value={who} maxLength={2000} onChange={(e) => setWho(e.target.value)} /></label>
          <div className="row between">
            <button className="btn ghost" onClick={() => setStep(0)}>← Voltar</button>
            <button className="btn primary" onClick={() => setStep(2)}>{words || who ? 'Continuar' : 'Pular por agora'}</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="stack">
          <p className="muted" style={{ margin: 0 }}>Poucas metas, bem escolhidas. O ideal são 1 a 3, ligadas às áreas em foco.</p>
          {goals.length > 0 && (
            <div className="card flush list">
              {goals.map((g, i) => (
                <div key={i} className="list-row">
                  <div className="grow stack" style={{ gap: 2 }}>
                    <span className="medium">{g.title}</span>
                    {g.done_definition && <span className="caption muted">Pronto quando: {g.done_definition}</span>}
                  </div>
                  <AreaTag area={areas.find((a) => a.id === g.area_id)} />
                  <button aria-label="Tirar meta" className="faint" onClick={() => setGoals(goals.filter((_, j) => j !== i))}><Icon name="x" size={16} /></button>
                </div>
              ))}
            </div>
          )}
          <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (!draft.title.trim()) return; setGoals([...goals, { area_id: draft.area_id || null, title: draft.title.trim(), done_definition: draft.done_definition.trim() }]); setDraft({ area_id: draft.area_id, title: '', done_definition: '' }) }}>
            <label className="field"><span>Meta</span><input className="input" placeholder="Ex.: Lançar o portfólio novo" value={draft.title} maxLength={200} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <label className="field"><span>Está pronta quando…</span><input className="input" placeholder="Ex.: site no ar com 3 projetos" value={draft.done_definition} maxLength={500} onChange={(e) => setDraft({ ...draft, done_definition: e.target.value })} /></label>
            <label className="field"><span>Área</span>
              <select className="input" value={draft.area_id} onChange={(e) => setDraft({ ...draft, area_id: e.target.value })}>
                <option value="">Sem área</option>
                {(focus.length ? focus : areas).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select></label>
            <button className="btn secondary" disabled={!draft.title.trim()}><Icon name="plus" size={16} />Adicionar meta</button>
          </form>
          <div className="row between">
            <button className="btn ghost" onClick={() => setStep(1)}>← Voltar</button>
            <button className="btn primary" disabled={busy || (!goals.length && !!draft.title.trim())} onClick={create}>{goals.length ? 'Criar ciclo' : 'Criar sem metas'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- ciclo em curso
function CicloAtivo({ data, cycle }: { data: ReturnType<typeof useCycle>; cycle: Cycle }) {
  const { goals, steps, areas } = data
  const now = weekOf(cycle)
  const execNow = Math.min(Math.max(now, 1), EXEC_WEEKS)
  const [week, setWeek] = useState(execNow)
  const [newGoal, setNewGoal] = useState(false)
  const [editVision, setEditVision] = useState(false)
  const nav = useNavigate()
  const { rows: reflections } = useRows<Reflection>('reflections', { eq: { cycle_id: cycle.id }, order: { column: 'week', ascending: false } })

  const weekSteps = steps.filter((s) => s.week === week)
  const pastSteps = steps.filter((s) => s.week < execNow)
  const ended = now > TOTAL_WEEKS
  const goalOf = (id: string) => goals.find((g) => g.id === id)
  const areaOf = (id: string | null) => areas.find((a) => a.id === id)
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
      <PageHeader eyebrow={cycle.name} title={
        now === 0 ? `Começa em ${daysUntil(cycle)} dia${daysUntil(cycle) === 1 ? '' : 's'}`
          : ended ? 'Ciclo terminado'
          : now === TOTAL_WEEKS ? 'Semana de revisão'
          : `Semana ${now} de ${EXEC_WEEKS}`}
        right={<div className="row" style={{ gap: 8 }}><Link className="btn secondary small" to="/grupo"><Icon name="users" size={16} />Grupo</Link><Link className="btn primary small" to="/ciclo/ritual"><Icon name="sparkle" size={16} />Ritual da semana</Link></div>} />

      <div className="weeks" aria-label={`Semana ${now} de ${TOTAL_WEEKS}`}>
        {Array.from({ length: TOTAL_WEEKS }, (_, i) => i + 1).map((w) => (
          <span key={w} className={w === now ? 'now' : w < now ? 'past' : w === TOTAL_WEEKS ? 'review' : ''} title={`Semana ${w}`} />
        ))}
      </div>

      {ended && (
        <div className="card soft row between" style={{ flexWrap: 'wrap' }}>
          <span>As 13 semanas acabaram. Faça a revisão final e encerre para começar o próximo ciclo.</span>
          <button className="btn primary small" onClick={close}>Encerrar ciclo</button>
        </div>
      )}
      {!ended && now >= 1 && !reviewedNow && (
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
          {goals.length ? goals.map((g) => <GoalCard key={g.id} goal={g} steps={steps.filter((s) => s.goal_id === g.id)} area={areaOf(g.area_id)} current={execNow} />)
            : <Empty>Sem metas ainda. Escolha 1 a 3 para este ciclo.</Empty>}

          <SectionHead title="Quem você está se tornando" action={<button className="caption muted" onClick={() => setEditVision(true)}>editar</button>} />
          {cycle.words.length || cycle.who_is_she.length ? (
            <div className="card soft stack">
              {cycle.words.length > 0 && <div className="wordchips">{cycle.words.map((w) => <span key={w}>{w}</span>)}</div>}
              {cycle.who_is_she.map((w) => <span key={w}>· {w}</span>)}
            </div>
          ) : <Empty>Escreva as palavras do ciclo e quem você quer ser no fim dele.</Empty>}

          <SectionHead title="Reflexões" />
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
            {!ended && <button className="btn ghost small" onClick={close}>Encerrar ciclo antes do fim</button>}
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

function GoalCard({ goal, steps, area, current }: { goal: Goal; steps: Step[]; area?: Area; current: number }) {
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
          {goal.done_definition && <span className="caption muted">Pronto quando: {goal.done_definition}</span>}
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
              {Array.from({ length: EXEC_WEEKS }, (_, i) => i + 1).map((w) => <option key={w} value={w}>S{w}</option>)}
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
  const [title, setTitle] = useState('')
  const [def, setDef] = useState('')
  const [area, setArea] = useState(areaId ?? '')
  return (
    <Sheet open={open} onClose={onClose} title="Nova meta" labelledBy="goal-sheet">
      <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (!title.trim()) return
        await insert<Goal>('goals', { cycle_id: cycle.id, title: title.trim(), done_definition: def.trim() || null, area_id: area || null, kind: 'project', position })
        setTitle(''); setDef(''); onClose() }}>
        <label className="field"><span>Meta</span><input className="input" autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} /></label>
        <label className="field"><span>Está pronta quando…</span><input className="input" value={def} maxLength={500} onChange={(e) => setDef(e.target.value)} /></label>
        <label className="field"><span>Área</span>
          <select className="input" value={area} onChange={(e) => setArea(e.target.value)}>
            <option value="">Sem área</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select></label>
        <button className="btn primary" disabled={!title.trim()}>Criar meta</button>
      </form>
    </Sheet>
  )
}

function VisionSheet({ open, onClose, cycle }: { open: boolean; onClose: () => void; cycle: Cycle }) {
  const [words, setWords] = useState(cycle.words.join(', '))
  const [who, setWho] = useState(cycle.who_is_she.join('\n'))
  const [name, setName] = useState(cycle.name)
  return (
    <Sheet open={open} onClose={onClose} title="Visão do ciclo" labelledBy="vision-sheet">
      <form className="stack" onSubmit={async (e) => { e.preventDefault()
        await update<Cycle>('cycles', cycle.id, { name: name.trim() || cycle.name, words: splitList(words).slice(0, 10), who_is_she: splitList(who).slice(0, 20) }); onClose() }}>
        <label className="field"><span>Nome do ciclo</span><input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label className="field"><span>Palavras (separe por vírgula)</span><input className="input" value={words} maxLength={300} onChange={(e) => setWords(e.target.value)} /></label>
        <label className="field"><span>Quem você quer ser (uma frase por linha)</span><textarea className="input" rows={5} value={who} maxLength={2000} onChange={(e) => setWho(e.target.value)} /></label>
        <button className="btn primary">Guardar</button>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------- ritual semanal em 3 partes
const QUESTIONS = ['O que funcionou na semana passada?', 'O que travou, e o que muda agora?', 'Qual é o passo mais importante desta semana?', 'Como você quer se sentir no domingo?']

export function Ritual() {
  const { cycle, goals, steps, areas, loading } = useCycle()
  const nav = useNavigate()
  const { toast } = useOutletContext<ShellCtx>()
  const [params] = useSearchParams()
  const now = cycle ? Math.min(Math.max(weekOf(cycle), 1), TOTAL_WEEKS) : 1
  const week = Number(params.get('semana')) || now
  const { rows: refl } = useRows<Reflection>('reflections', cycle ? { eq: { cycle_id: cycle.id, week } } : undefined, !!cycle)
  const existing = refl.find((r) => r.kind === 'review')
  const [answers, setAnswers] = useState<string[] | null>(null)
  const [newStep, setNewStep] = useState({ goal: '', title: '' })
  const vals = answers ?? existing?.answers ?? ['', '', '', '']

  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>
  if (!cycle) return <div className="page"><PageHeader title="Ritual da semana" /><Empty>Crie um ciclo primeiro. <Link className="link" to="/ciclo">Criar ciclo</Link></Empty></div>

  const last = steps.filter((s) => s.week === week - 1)
  const lastScore = score(last)
  const pending = last.filter((s) => !s.done_at)
  const thisWeek = steps.filter((s) => s.week === week)
  const set = (i: number, v: string) => { const n = [...vals]; n[i] = v; setAnswers(n) }

  async function save() {
    const payload = { answers: vals.map((v) => v.trim()), score: lastScore }
    if (existing) await update<Reflection>('reflections', existing.id, payload)
    else await insert<Reflection>('reflections', { cycle_id: cycle!.id, kind: 'review', week, ...payload })
    toast('Ritual guardado. Boa semana!')
    nav('/ciclo')
  }

  return (
    <div className="page">
      <PageHeader eyebrow={`${cycle.name} · semana ${week}`} title="Ritual da semana" right={<Link className="btn ghost small" to="/ciclo">Fechar</Link>} />

      <section className="stack">
        <div className="row"><span className="ritual-num">1</span><h2 className="h2">Olhar para trás</h2></div>
        {week > 1 ? (
          <div className="card row between">
            <div className="stack" style={{ gap: 2 }}><span className="mono muted">Semana {week - 1}</span><span>{last.length ? `${last.length - pending.length} de ${last.length} passos feitos` : 'Nenhum passo planejado'}</span></div>
            <span className="big" style={{ fontSize: 36 }}>{lastScore == null ? '–' : `${lastScore}%`}</span>
          </div>
        ) : <div className="card soft caption">Primeira semana do ciclo: nada para olhar ainda. Comece pelo plano.</div>}
        <label className="field"><span>{QUESTIONS[0]}</span><textarea className="input" rows={2} maxLength={1000} value={vals[0]} onChange={(e) => set(0, e.target.value)} /></label>
        <label className="field"><span>{QUESTIONS[1]}</span><textarea className="input" rows={2} maxLength={1000} value={vals[1]} onChange={(e) => set(1, e.target.value)} /></label>
      </section>

      <section className="stack">
        <div className="row"><span className="ritual-num">2</span><h2 className="h2">Planejar a semana</h2></div>
        {pending.length > 0 && (
          <div className="card stack" style={{ gap: 8 }}>
            <span className="caption muted">Ficaram da semana passada:</span>
            {pending.map((s) => (
              <div key={s.id} className="row">
                <span className="grow">{s.title}</span>
                <button className="btn secondary small" onClick={() => update<Step>('steps', s.id, { week })}>Trazer</button>
              </div>
            ))}
          </div>
        )}
        <div className="card flush list">
          {thisWeek.map((s) => (
            <div key={s.id} className="list-row">
              <Check done={!!s.done_at} onToggle={() => toggleStep(s)} label={`Concluir ${s.title}`} />
              <span className={'grow' + (s.done_at ? ' done-text' : '')}>{s.title}</span>
              <AreaTag area={areas.find((a) => a.id === goals.find((g) => g.id === s.goal_id)?.area_id)} />
            </div>
          ))}
          {goals.length ? (
            <form className="list-row" style={{ flexWrap: 'wrap' }} onSubmit={async (e) => { e.preventDefault(); const g = newStep.goal || goals[0].id; const t = newStep.title.trim(); if (!t) return; setNewStep({ ...newStep, title: '' })
              await insert<Step>('steps', { goal_id: g, title: t, week, position: thisWeek.length }) }}>
              <input className="input grow" style={{ minWidth: 180 }} placeholder="Passo para esta semana" value={newStep.title} maxLength={200} onChange={(e) => setNewStep({ ...newStep, title: e.target.value })} aria-label="Novo passo" />
              <select className="input" style={{ width: 'auto', maxWidth: 200 }} value={newStep.goal} onChange={(e) => setNewStep({ ...newStep, goal: e.target.value })} aria-label="Meta">
                {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
              </select>
              <button className="icon-btn ink" aria-label="Adicionar passo" disabled={!newStep.title.trim()}><Icon name="plus" size={18} /></button>
            </form>
          ) : <div className="list-row caption muted">Crie uma meta no Ciclo para planejar passos.</div>}
        </div>
      </section>

      <section className="stack">
        <div className="row"><span className="ritual-num">3</span><h2 className="h2">Compromisso</h2></div>
        <label className="field"><span>{QUESTIONS[2]}</span><input className="input" maxLength={300} value={vals[2]} onChange={(e) => set(2, e.target.value)} /></label>
        <label className="field"><span>{QUESTIONS[3]}</span><input className="input" maxLength={300} value={vals[3]} onChange={(e) => set(3, e.target.value)} /></label>
      </section>

      <button className="btn primary block" onClick={save}>{existing ? 'Guardar alterações' : 'Fechar o ritual'}</button>
    </div>
  )
}

// ---------------------------------------------------------------- página de uma área
export function AreaPage() {
  const { id } = useParams()
  const { cycle, goals, steps, areas, loading } = useCycle()
  const { rows: habits } = useRows<Habit>('habits', { eq: { area_id: id ?? '', archived: false } }, !!id)
  const [newGoal, setNewGoal] = useState(false)
  const [habit, setHabit] = useState('')
  const area = areas.find((a) => a.id === id)
  if (!area) return <div className="page"><p className="muted">{loading ? 'Carregando…' : 'Área não encontrada.'}</p></div>
  const set = (patch: Partial<Area>) => update<Area>('areas', area.id, patch)
  const areaGoals = goals.filter((g) => g.area_id === area.id)
  const current = cycle ? Math.min(Math.max(weekOf(cycle), 1), EXEC_WEEKS) : 1

  return (
    <div className="page" key={area.id}>
      <header className="card stack" style={{ background: `var(--${area.color}-bg)`, color: `var(--${area.color}-fg)`, gap: 8 }}>
        <div className="row between"><span className="mono">Área da vida</span>
          {!area.is_fixed && <span className="row caption" style={{ gap: 8 }}>Em foco <Toggle label="Em foco neste ciclo" on={area.focus} onChange={(v) => set({ focus: v })} /></span>}
        </div>
        <h1 className="h1">{area.name}</h1>
      </header>

      <div className="card stack">
        <span className="h3">Como está</span>
        <ScoreSlider label="Hoje" value={area.score_now} onChange={(v) => set({ score_now: v })} />
        <ScoreSlider label="Onde quero chegar" value={area.score_goal} onChange={(v) => set({ score_goal: v })} />
      </div>

      <label className="field"><span>Por que esta área importa para você</span>
        <textarea className="input" rows={3} maxLength={2000} defaultValue={area.why ?? ''} onBlur={(e) => e.target.value !== (area.why ?? '') && set({ why: e.target.value || null })} /></label>
      <label className="field"><span>O que quero melhorar</span>
        <textarea className="input" rows={3} maxLength={2000} defaultValue={area.improve ?? ''} onBlur={(e) => e.target.value !== (area.improve ?? '') && set({ improve: e.target.value || null })} /></label>

      <SectionHead title="Metas neste ciclo" action={cycle && <button className="btn secondary small" onClick={() => setNewGoal(true)}><Icon name="plus" size={14} />Meta</button>} />
      {!cycle ? <Empty>Sem ciclo em curso. <Link className="link" to="/ciclo">Criar ciclo</Link></Empty>
        : areaGoals.length ? areaGoals.map((g) => <GoalCard key={g.id} goal={g} steps={steps.filter((s) => s.goal_id === g.id)} area={area} current={current} />)
        : <Empty>Nenhuma meta desta área no ciclo atual.</Empty>}

      <SectionHead title="Hábitos" />
      <div className="card flush list">
        {habits.map((h) => (
          <div key={h.id} className="list-row"><span className="grow">{h.title}</span>
            <button aria-label={`Arquivar ${h.title}`} className="faint" onClick={() => update<Habit>('habits', h.id, { archived: true })}><Icon name="x" size={16} /></button></div>
        ))}
        <form className="list-row" onSubmit={async (e) => { e.preventDefault(); const t = habit.trim(); if (!t) return; setHabit(''); await insert<Habit>('habits', { title: t, area_id: area.id, days: [0, 1, 2, 3, 4, 5, 6] }) }}>
          <Icon name="plus" size={18} className="faint" />
          <input className="input bare grow" placeholder="Novo hábito diário" value={habit} maxLength={120} onChange={(e) => setHabit(e.target.value)} aria-label="Novo hábito" />
        </form>
      </div>

      {cycle && <GoalSheet open={newGoal} onClose={() => setNewGoal(false)} cycle={cycle} areas={areas} position={goals.length} areaId={area.id} />}
    </div>
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
