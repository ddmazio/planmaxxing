import { useEffect, useMemo, useState, type DragEvent } from 'react'
import { Link, useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'
import { insert, rpc, select, update, DEMO } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, toIso, todayYmd, ymd } from '../lib/dates'
import { EXEC_WEEKS, score, weekOf } from '../lib/cycle'
import { cycleWeekDays } from '../lib/execution'
import type { CalEvent, Checkin, Cheer, Group, Habit, HabitLog, Reflection, Step } from '../lib/types'
import { AreaTag, Empty, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader, type ShellCtx } from '../components/Shell'
import { useCycle } from './Ciclo'
import { groupWeek, usePeople } from './Grupo'

type Phase = 'plan' | 'close'
const PLAN = ['Atrasadas', 'Sua semana', 'Distribuir']
const CLOSE = ['Placar', 'Check-in']
const WEIGHTS = ['Planejei demais', 'Imprevistos', 'Cansaço ou saúde', 'Trabalho ou estudos apertaram', 'Passos pouco claros', 'Esqueci de olhar o plano']
const HOURS = Array.from({ length: 15 }, (_, i) => i + 7) // 07h a 21h
const GOOD = 85

/** Período curto de uma data: “9 a 12 nov”, “14 nov”. */
function span(e: CalEvent) {
  const a = new Date(e.starts_at)
  const b = new Date(new Date(e.ends_at).getTime() - (e.all_day ? 1 : 0))
  return a.toDateString() === b.toDateString() ? fmt(a, 'd MMM') : `${fmt(a, 'd')} a ${fmt(b, 'd MMM')}`
}

export function Ritual() {
  const { cycle, goals, steps, areas, loading } = useCycle()
  const nav = useNavigate()
  const { toast } = useOutletContext<ShellCtx>()
  const [params] = useSearchParams()
  const now = cycle ? weekOf(cycle) : 0
  // fecha a semana em curso (ou a escolhida) e planeja a seguinte
  const W = Math.min(Math.max(Number(params.get('semana')) || now, 1), EXEC_WEEKS)
  const P = W < EXEC_WEEKS ? W + 1 : null
  const wDays = cycle ? cycleWeekDays(cycle, W) : []
  const pDays = cycle && P ? cycleWeekDays(cycle, P) : []

  const { rows: refl } = useRows<Reflection>('reflections', cycle ? { eq: { cycle_id: cycle.id } } : undefined, !!cycle)
  const { rows: habits } = useRows<Habit>('habits', { eq: { archived: false } })
  const { rows: logs } = useRows<HabitLog>('habit_logs', { gte: { day: wDays[0] ?? todayYmd() } }, !!cycle)
  const { rows: events } = useRows<CalEvent>('events', pDays.length ? { gte: { starts_at: toIso(pDays[0]) }, lt: { starts_at: toIso(ymd(addDays(fromYmd(pDays[6]), 1))) }, order: { column: 'starts_at' } } : undefined, pDays.length > 0)
  const { rows: groups } = useRows<Group>('groups', { order: { column: 'created_at' } }, !DEMO)

  const existing = refl.find((r) => r.kind === 'review' && r.week === W)
  const [phase, setPhase] = useState<Phase>(P ? 'plan' : 'close')
  const [step, setStep] = useState(0)
  const [answers, setAnswers] = useState<string[] | null>(null)
  const [share, setShare] = useState<boolean | null>(null)
  const vals = answers ?? existing?.answers ?? ['', '', '', '']
  const setA = (i: number, v: string) => { const n = [...vals]; while (n.length < 4) n.push(''); n[i] = v; setAnswers(n) }

  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>
  if (!cycle) return <div className="page"><PageHeader title="Ritual da semana" /><Empty>Crie um ciclo primeiro. <Link className="link" to="/ciclo">Criar ciclo</Link></Empty></div>

  // ---- placar da semana W
  const wSteps = steps.filter((s) => s.week === W)
  const wScore = score(wSteps)
  const habitDue = habits.flatMap((h) => wDays.filter((d) => d <= todayYmd() && d >= (h.created_at?.slice(0, 10) ?? '') && h.days.includes(fromYmd(d).getDay())).map((d) => [h.id, d] as const))
  const habitHit = habitDue.filter(([id, d]) => logs.some((l) => l.habit_id === id && l.day === d)).length
  let goodRun = 0
  for (let w = W; w >= 1; w--) { const v = score(steps.filter((s) => s.week === w)); if (v != null && v >= GOOD) goodRun++; else break }
  const good = (wScore ?? 0) >= GOOD
  const shareOn = share ?? good
  const recent = [W, W - 1, W - 2].filter((w) => w >= 1).map((w) => steps.filter((s) => s.week === w)).filter((x) => x.length)
  const avgPlanned = recent.length ? Math.round(recent.reduce((a, x) => a + x.length, 0) / recent.length) : 0
  const avgDone = recent.length ? Math.round(recent.reduce((a, x) => a + x.filter((s) => s.done_at).length, 0) / recent.length) : 0
  const suggest = Math.max(1, Math.round(avgDone * 1.15))

  async function finish() {
    const clean = vals.map((v) => (v ?? '').trim())
    const payload = { answers: clean, score: wScore, title: null }
    if (existing) await update<Reflection>('reflections', existing.id, payload)
    else await insert<Reflection>('reflections', { cycle_id: cycle!.id, kind: 'review', week: W, prompt: null, ...payload })
    if (shareOn && groups.length) {
      for (const g of groups) {
        const gw = groupWeek(g)
        const mine = await rpcMine(g.id, gw)
        const body = { score: wScore ?? 0, intention: clean[2] || null, worked: clean[0] || null }
        try { if (mine) await update<Checkin>('checkins', mine.id, body); else await insert<Checkin>('checkins', { group_id: g.id, week: gw, ...body }) } catch { /* segue */ }
      }
    }
    toast(shareOn && groups.length ? 'Semana fechada e check-in enviado ao grupo.' : 'Semana fechada. Boa semana!')
    nav('/')
  }

  const go = (ph: Phase, i: number) => { setPhase(ph); setStep(i); window.scrollTo({ top: 0 }) }
  const next = () => (phase === 'plan' ? (step < 2 ? go('plan', step + 1) : go('close', 0)) : go('close', 1))
  const back = () => { if (phase === 'close') { if (step > 0) go('close', 0); else if (P) go('plan', 2) } else if (step > 0) go('plan', step - 1) }
  const range = (days: string[]) => `${fmt(fromYmd(days[0]), 'd')} a ${fmt(fromYmd(days[6]), 'd MMM')}`

  return (
    <div className="page wide ritual-page">
      <aside className="ritual-rail">
        <span className="mono muted">{fmt(new Date(), 'EEEE')} · semana {W}</span>
        {P && (
          <div className="stack" style={{ gap: 6 }}>
            <button className={'rail-head' + (phase === 'plan' ? ' on' : '')} onClick={() => go('plan', 0)}>
              <span className="mono">Planejar a semana</span><span className="caption muted">{phase === 'plan' ? `${step + 1} de 3` : 'feita ✓'}</span>
            </button>
            {phase === 'plan' && PLAN.map((l, i) => <button key={l} className={'rail-item' + (i === step ? ' on' : i < step ? ' done' : '')} onClick={() => go('plan', i)}>{l}</button>)}
          </div>
        )}
        <div className="stack" style={{ gap: 6 }}>
          <button className={'rail-head' + (phase === 'close' ? ' on' : '')} onClick={() => go('close', 0)}>
            <span className="mono">Fechar a semana</span><span className="caption muted">{phase === 'close' ? `${step + 1} de 2` : '2 etapas'}</span>
          </button>
          {phase === 'close' && CLOSE.map((l, i) => <button key={l} className={'rail-item' + (i === step ? ' on' : i < step ? ' done' : '')} onClick={() => go('close', i)}>{l}</button>)}
        </div>
        <span className="caption faint">Uns 10 minutos, todo domingo</span>
      </aside>

      <section className="stack ritual-main">
        <div className="row between">
          <span className="mono muted">{phase === 'plan' ? `Planejar · ${step + 1} de 3` : `Fechar · ${step + 1} de 2`}</span>
          <Link className="btn ghost small" to="/ciclo"><Icon name="x" size={14} />Fechar</Link>
        </div>

        {phase === 'plan' && P && step === 0 && <Atrasadas W={W} P={P} steps={steps} goals={goals} pRange={range(pDays)} />}
        {phase === 'plan' && P && step === 1 && <SuaSemana P={P} steps={steps} goals={goals} areas={areas} habits={habits} events={events} pRange={range(pDays)} />}
        {phase === 'plan' && P && step === 2 && <Distribuir P={P} days={pDays} steps={steps} goals={goals} habits={habits} events={events} />}

        {phase === 'close' && step === 0 && (
          <div className="stack">
            <span className="mono muted">Semana {W} fechada · {range(wDays)}</span>
            <div className="row" style={{ alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span className={'big score-hero' + (good ? ' ok' : '')}>{wScore == null ? '–' : `${wScore}%`}</span>
              <span className="h2">{wScore == null ? 'Sem passos nesta semana.' : good ? 'Semana de sucesso.' : 'Semana difícil acontece. Bora entender?'}</span>
            </div>
            <div className="habit-stats">
              <div className="card stack" style={{ gap: 0 }}><span className="big">{wSteps.filter((s) => s.done_at).length}/{wSteps.length}</span><span className="caption muted">passos</span></div>
              <div className="card stack" style={{ gap: 0 }}><span className="big">{habitHit}/{habitDue.length}</span><span className="caption muted">hábitos</span></div>
              <div className="card stack" style={{ gap: 0 }}><span className="big">{goodRun ? `${goodRun}ª` : '–'}</span><span className="caption muted">semana ≥ 85%{goodRun > 1 ? ' seguida' : ''}</span></div>
            </div>
            {good || wScore == null ? (
              <label className="field"><span>O que funcionou esta semana?</span>
                <textarea className="input" rows={3} maxLength={1000} value={vals[0] ?? ''} onChange={(e) => setA(0, e.target.value)} /></label>
            ) : (
              <>
                <span className="medium">O que pesou mais? <span className="caption muted">(pode marcar mais de um)</span></span>
                <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
                  {WEIGHTS.map((w) => {
                    const sel = (vals[1] ?? '').split(' · ').includes(w)
                    return <button key={w} className={'chip' + (sel ? ' on' : '')} aria-pressed={sel} onClick={() => {
                      const cur = (vals[1] ?? '').split(' · ').filter(Boolean)
                      setA(1, (sel ? cur.filter((x) => x !== w) : [...cur, w]).join(' · '))
                    }}>{w}</button>
                  })}
                </div>
                {avgPlanned > 0 && (
                  <div className="card soft stack" style={{ gap: 4 }}>
                    <span className="mono muted">Sugestão</span>
                    <span>Nas últimas {recent.length} semana{recent.length === 1 ? '' : 's'} você planejou {avgPlanned} passo{avgPlanned === 1 ? '' : 's'} e fez {avgDone} em média.{P ? ` Que tal planejar ${suggest} na semana ${P}?` : ''}</span>
                  </div>
                )}
                <label className="field"><span>Algo funcionou mesmo assim?</span>
                  <textarea className="input" rows={2} maxLength={1000} value={vals[0] ?? ''} onChange={(e) => setA(0, e.target.value)} /></label>
                <p className="caption muted" style={{ margin: 0 }}>Lembrete: o placar mede o que você fez, não o seu valor. 85% é a meta, não 100%.</p>
              </>
            )}
            {groups.length > 0 && (
              <div className="card row between">
                <div className="stack" style={{ gap: 2 }}><span>Mostrar no check-in do grupo</span>
                  <span className="caption muted">{shareOn ? 'O grupo vê o placar e a sua intenção, conforme a privacidade de cada grupo.' : 'Você decide. Desligado esta semana.'}</span></div>
                <Toggle label="Mostrar no check-in do grupo" on={shareOn} onChange={setShare} />
              </div>
            )}
          </div>
        )}

        {phase === 'close' && step === 1 && (
          <CheckinStep W={W} P={P} score={wScore} vals={vals} setA={setA} groups={groups} shareOn={shareOn} />
        )}

        <div className="row between" style={{ marginTop: 8 }}>
          {(phase === 'plan' && step === 0) || (!P && phase === 'close' && step === 0) ? <span /> : <button className="btn secondary" onClick={back}>Voltar</button>}
          {phase === 'close' && step === 1
            ? <button className="btn primary" onClick={finish}>{existing ? 'Guardar' : 'Fechar a semana'}</button>
            : <button className="btn primary" onClick={next}>{phase === 'plan' && step === 2 ? 'Agora, fechar a semana' : 'Continuar'}</button>}
        </div>
      </section>
    </div>
  )
}

async function rpcMine(group: string, week: number) {
  try { return (await select<Checkin>('checkins', { eq: { group_id: group, week } }))[0] ?? null } catch { return null }
}

// ---------------------------------------------------------------- planejar 1: atrasadas
function Atrasadas({ W, P, steps, goals, pRange }: { W: number; P: number; steps: Step[]; goals: { id: string; title: string }[]; pRange: string }) {
  const [kept, setKept] = useState<string[]>([])
  const carried = (s: Step) => steps.some((x) => x.week > W && x.goal_id === s.goal_id && x.title === s.title)
  const late = steps.filter((s) => s.week <= W && !s.done_at)
  const open = late.filter((s) => !carried(s) && !kept.includes(s.id))
  const carry = (s: Step) => insert<Step>('steps', { goal_id: s.goal_id, title: s.title, week: P, detail: `veio da S${s.week}`, position: 999 })
  return (
    <div className="stack">
      <span className="mono muted">Semana {P} · {pRange}</span>
      <h1 className="h1">{late.length ? `Antes de começar: ${late.length} passo${late.length === 1 ? '' : 's'} ficaram para trás.` : 'Nada ficou para trás. Bom sinal.'}</h1>
      {late.length > 0 && <p className="muted" style={{ margin: 0 }}>Eles continuam contando na semana deles. Decida o destino de cada um.</p>}
      {late.length > 0 && (
        <div className="card flush list">
          {late.map((s) => {
            const done = carried(s), stay = kept.includes(s.id)
            return (
              <div key={s.id} className="list-row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
                <div className="grow stack" style={{ gap: 2, minWidth: 200 }}>
                  <span>{s.title}</span>
                  <span className="caption muted">S{s.week} · {goals.find((g) => g.id === s.goal_id)?.title ?? ''} · não feito</span>
                </div>
                {done ? <span className="pill caption">levado para S{P} ✓</span>
                  : stay ? <span className="pill caption">fica onde está</span>
                  : <div className="row" style={{ gap: 6 }}>
                      <button className="btn secondary small" onClick={() => setKept([...kept, s.id])}>Deixar</button>
                      <button className="btn primary small" onClick={() => carry(s)}>Levar para S{P}</button>
                    </div>}
              </div>
            )
          })}
        </div>
      )}
      {open.length > 1 && <button className="caption medium" style={{ alignSelf: 'flex-start' }} onClick={async () => { for (const s of open) await carry(s) }}>Levar todos para a S{P}</button>}
    </div>
  )
}

// ---------------------------------------------------------------- planejar 2: sua semana
function SuaSemana({ P, steps, goals, areas, habits, events, pRange }: {
  P: number; steps: Step[]; goals: { id: string; title: string; area_id: string | null }[]; areas: import('../lib/types').Area[]; habits: Habit[]; events: CalEvent[]; pRange: string
}) {
  const [all, setAll] = useState(false)
  const [title, setTitle] = useState('')
  const [goal, setGoal] = useState('')
  const pSteps = steps.filter((s) => s.week === P)
  const heavy = events.filter((e) => e.all_day || new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime() >= 3 * 3600e3)
  const shown = all ? pSteps : pSteps.slice(0, 6)
  return (
    <div className="stack">
      <span className="mono muted">Semana {P} · {pRange}</span>
      <h1 className="h1">{pSteps.length ? 'Sua semana já está montada.' : 'Sua semana ainda está vazia.'}</h1>
      {heavy.length > 0 && (
        <div className="card lime stack" style={{ gap: 4 }}>
          <span className="mono">Atenção nesta semana</span>
          <span>{heavy.slice(0, 3).map((e) => `${e.title} (${span(e)})`).join(' e ')}{heavy.length > 3 ? ` e mais ${heavy.length - 3}` : ''}. Quer aliviar a semana?</span>
        </div>
      )}
      <div className="habit-stats">
        <div className="card stack" style={{ gap: 0 }}><span className="big">{pSteps.length}</span><span className="caption muted">passos</span></div>
        <div className="card stack" style={{ gap: 0 }}><span className="big">{habits.length}</span><span className="caption muted">hábitos</span></div>
        <div className="card stack" style={{ gap: 0 }}><span className="big">{events.length}</span><span className="caption muted">eventos</span></div>
      </div>
      <div className="card flush list">
        {shown.map((s) => {
          const g = goals.find((x) => x.id === s.goal_id)
          return (
            <div key={s.id} className="list-row">
              <div className="grow stack" style={{ gap: 2 }}><span>{s.title}</span><span className="caption muted">{s.detail ? `${s.detail} · ` : ''}{g?.title}</span></div>
              <AreaTag area={areas.find((a) => a.id === g?.area_id)} />
              {P < EXEC_WEEKS && <button className="btn ghost small" onClick={() => update<Step>('steps', s.id, { week: P + 1 })} aria-label={`Passar ${s.title} para a semana ${P + 1}`}>→ S{P + 1}</button>}
            </div>
          )
        })}
        {pSteps.length > 6 && <button className="list-row caption medium" onClick={() => setAll(!all)}>{all ? 'mostrar menos' : `+ ${pSteps.length - 6} passos · ver todos`}</button>}
        {goals.length > 0 && (
          <form className="list-row" style={{ flexWrap: 'wrap' }} onSubmit={async (e) => { e.preventDefault(); const t = title.trim(); if (!t) return; setTitle('')
            await insert<Step>('steps', { goal_id: goal || goals[0].id, title: t, week: P, position: pSteps.length }) }}>
            <Icon name="plus" size={18} className="faint" />
            <input className="input bare grow" style={{ minWidth: 160 }} placeholder={`Passo para a semana ${P}`} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} aria-label="Novo passo" />
            <select className="input" style={{ width: 'auto', maxWidth: 200 }} value={goal} onChange={(e) => setGoal(e.target.value)} aria-label="Meta">
              {goals.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
            </select>
          </form>
        )}
      </div>
      {heavy.length > 0 && <p className="caption muted" style={{ margin: 0 }}>Para aliviar, passe alguns passos para a semana {P + 1} com o botão “→”.</p>}
    </div>
  )
}

// ---------------------------------------------------------------- planejar 3: distribuir na agenda
interface Item { key: string; title: string; area_id: string | null; kind: 'passo' | 'hábito' }

function Distribuir({ P, days, steps, goals, habits, events }: { P: number; days: string[]; steps: Step[]; goals: { id: string; area_id: string | null }[]; habits: Habit[]; events: CalEvent[] }) {
  const [sel, setSel] = useState<string | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const placed = (t: string) => events.some((e) => e.title === t)
  const items: Item[] = useMemo(() => [
    ...steps.filter((s) => s.week === P && !s.done_at).map((s) => ({ key: 's' + s.id, title: s.title, area_id: goals.find((g) => g.id === s.goal_id)?.area_id ?? null, kind: 'passo' as const })),
    ...habits.map((h) => ({ key: 'h' + h.id, title: h.title, area_id: h.area_id, kind: 'hábito' as const })),
  ].filter((i) => !placed(i.title)), [steps, habits, goals, events, P]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (sel && !items.some((i) => i.key === sel)) setSel(null) }, [items, sel])

  async function place(key: string, day: string, hour: number) {
    const it = items.find((i) => i.key === key)
    if (!it) return
    const start = new Date(`${day}T${String(hour).padStart(2, '0')}:00:00`)
    await insert<CalEvent>('events', { title: it.title, starts_at: start.toISOString(), ends_at: new Date(start.getTime() + 3600e3).toISOString(), all_day: false, kind: 'plan', area_id: it.area_id, location: null, notes: null, reminder_minutes: null })
    setSel(null)
  }
  const at = (day: string, h: number) => events.filter((e) => { const d = new Date(e.starts_at); return !e.all_day && ymd(d) === day && d.getHours() === h })
  const drop = (day: string, h: number) => (ev: DragEvent) => { ev.preventDefault(); setOver(null); const k = ev.dataTransfer.getData('text/plain'); if (k) place(k, day, h) }

  return (
    <div className="stack">
      <span className="mono muted">Arraste para a agenda</span>
      <h1 className="h1">Quando cada coisa acontece?</h1>
      <p className="caption muted" style={{ margin: 0 }}>Arraste um item para um horário. No celular, toque no item e depois no horário. Cada bloco vira um compromisso de 1 hora na sua agenda do app.</p>
      <div className="distrib">
        <div className="card stack distrib-list">
          <div className="row between"><span className="mono muted">Sem horário ainda</span><span className="count-pill">{items.length}</span></div>
          {items.length ? items.map((i) => (
            <button key={i.key} draggable onDragStart={(e) => { e.dataTransfer.setData('text/plain', i.key); setSel(i.key) }}
              className={'drag-item' + (sel === i.key ? ' on' : '')} onClick={() => setSel(sel === i.key ? null : i.key)} aria-pressed={sel === i.key}>
              <span className="faint" aria-hidden>⋮⋮</span><span className="grow" style={{ textAlign: 'left' }}>{i.title}</span><span className="caption faint">{i.kind}</span>
            </button>
          )) : <span className="caption muted">Tudo tem horário. 👏</span>}
        </div>
        <div className="card flush distrib-grid-wrap">
          <div className="distrib-grid">
            <span />
            {days.map((d) => <span key={d} className="mono muted dg-head">{fmt(fromYmd(d), 'EEE d')}</span>)}
            {HOURS.map((h) => (
              <div key={h} style={{ display: 'contents' }}>
                <span className="mono faint dg-hour">{String(h).padStart(2, '0')}:00</span>
                {days.map((d) => {
                  const k = `${d}-${h}`
                  const evs = at(d, h)
                  return (
                    <div key={k} className={'dg-cell' + (over === k ? ' over' : '') + (sel ? ' can' : '')}
                      onDragOver={(e) => { e.preventDefault(); setOver(k) }} onDragLeave={() => setOver(null)} onDrop={drop(d, h)}
                      onClick={() => sel && place(sel, d, h)} role={sel ? 'button' : undefined} aria-label={sel ? `Colocar às ${h}h de ${fmt(fromYmd(d), 'EEEE')}` : undefined}>
                      {evs.map((e) => <span key={e.id} className="dg-ev" title={e.title}>{e.title}</span>)}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="caption muted" style={{ margin: 0 }}>Dica: um bloco de foco de 3h por semana já muda o jogo.</p>
    </div>
  )
}

// ---------------------------------------------------------------- fechar 2: check-in
function CheckinStep({ W, P, score: s, vals, setA, groups, shareOn }: { W: number; P: number | null; score: number | null; vals: string[]; setA: (i: number, v: string) => void; groups: Group[]; shareOn: boolean }) {
  const { people } = usePeople()
  const { session } = useAuth()
  const meId = session?.user.id
  const [others, setOthers] = useState<{ group: string; group_id: string; user_id: string; score: number | null; intention: string | null; worked?: string | null }[]>([])
  const [sent, setSent] = useState<string[]>([])
  useEffect(() => {
    let alive = true
    Promise.all(groups.map((g) => rpc<{ user_id: string; score: number | null; intention: string | null; worked?: string | null }[]>('group_scores', { p_group: g.id, p_week: groupWeek(g) })
      .then((rows) => rows.map((r) => ({ ...r, group: g.name, group_id: g.id }))).catch(() => [])))
      .then((all) => { if (alive) setOthers(all.flat().filter((o) => o.user_id !== meId)) })
    return () => { alive = false }
  }, [groups, meId])
  const nameOf = (id: string) => people.find((p) => p.id === id)?.display_name?.split(' ')[0] || 'Alguém'

  return (
    <div className="stack">
      <span className="mono muted">Check-in · S{P ?? W}</span>
      <h1 className="h1">Seu check-in da semana</h1>
      <div className="card stack" style={{ gap: 6 }}>
        <span className="mono muted">1 · Como foi a semana {W}</span>
        <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big" style={{ fontSize: 40 }}>{s == null ? '–' : `${s}%`}</span><span className="caption muted">de execução</span></div>
        <input className="input" placeholder="Em uma linha (ex.: 1 entrevista marcada)" maxLength={200} value={vals[3] ?? ''} onChange={(e) => setA(3, e.target.value)} aria-label="Como foi a semana, em uma linha" />
      </div>
      {P && (
        <label className="card stack" style={{ gap: 6 }}>
          <span className="mono muted">2 · Intenção para a semana {P}</span>
          <input className="input" placeholder="Ex.: fechar 2 entrevistas e ensaiar a apresentação" maxLength={300} value={vals[2] ?? ''} onChange={(e) => setA(2, e.target.value)} />
        </label>
      )}
      <label className="card stack" style={{ gap: 6 }}>
        <span className="mono muted">3 · O que funcionou (para o grupo copiar)</span>
        <textarea className="input" rows={2} maxLength={1000} value={vals[0] ?? ''} onChange={(e) => setA(0, e.target.value)} />
      </label>
      <div className="card stack" style={{ gap: 8 }}>
        <span className="mono muted">4 · Incentivo</span>
        {!groups.length ? <span className="caption muted">Quando você tiver um grupo, o placar das outras pessoas aparece aqui. <Link className="link" to="/grupo">Criar grupo</Link></span>
          : others.length ? others.map((o) => (
            <div key={o.group + o.user_id} className="row" style={{ gap: 10 }}>
              <span className="avatar" style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)' }}>{nameOf(o.user_id).charAt(0)}</span>
              <div className="grow stack" style={{ gap: 0 }}><span>{nameOf(o.user_id)} · {o.score == null ? 'sem placar' : `${o.score}%`}</span>
                {o.intention && <span className="caption muted">“{o.intention}”</span>}
                {o.worked && <span className="caption muted">Funcionou: {o.worked}</span>}</div>
              <button className={'btn small ' + (sent.includes(o.group_id + o.user_id) ? 'primary' : 'secondary')} disabled={sent.includes(o.group_id + o.user_id)} onClick={async () => {
                const g = groups.find((x) => x.id === o.group_id)!
                try { await insert<Cheer>('cheers', { group_id: o.group_id, week: groupWeek(g), to_id: o.user_id, emoji: '👏' }) } catch { /* já mandou */ }
                setSent([...sent, o.group_id + o.user_id])
              }}>{sent.includes(o.group_id + o.user_id) ? '👏 Enviado' : '👏 Mande um incentivo'}</button>
            </div>
          )) : <span className="caption muted">Ninguém do grupo fez o check-in ainda.</span>}
        {groups.length > 0 && <span className="caption faint">{shareOn ? 'Ao fechar, seu placar e sua intenção vão para o check-in do grupo.' : 'Você escolheu não mostrar esta semana ao grupo.'}</span>}
      </div>
    </div>
  )
}
