import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { insert, remove, update } from '../lib/db'
import { RITUAL_NAMES, RITUAL_ORDER, RITUAL_P1, RITUAL_P2, RITUAL_P3 } from '../lib/ritual'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, toIso, weekStart, ymd } from '../lib/dates'
import { currentCycle, execWeeks, newCycleDates, score, totalWeeks, weekOf } from '../lib/cycle'
import { AREA_CATALOG, normName, presetArea } from '../lib/areas'
import { DurationPicker } from '../components/DurationPicker'
import { useApp } from '../lib/app'
import { useAuth } from '../lib/auth'
import type { Area, CalEvent, Cycle, Goal, Habit, Reflection, Step, Task } from '../lib/types'
import { AreaIcon, AreaTag, Empty, Sheet } from '../components/ui'
import { Icon } from '../components/Icon'
import { ListInput } from '../components/ListInput'
import { type ShellCtx } from '../components/Shell'

// ---------------------------------------------------------------- estado do ritual (guardado como JSON numa reflexão)
interface Win { t: string; how: string }
interface Miss { t: string; why: string }
interface AreaRefl { score: number | null; good: Win[]; bad: Miss[]; improve: string[] }
type Kind = 'project' | 'habit' | 'both'
type ItemType = 'projeto' | 'habito' | 'tarefa' | 'evento'
interface Meta { id: string; area: string; t: string; kind: Kind; done: string }
interface Item { id: string; area: string; meta: string | null; t: string; type: ItemType; date?: string; days?: number[]; week?: number }
interface RT {
  v: 2; step: number; sub: number
  reflect: string[]; created: string[]; refl: Record<string, AreaRefl>
  focus: string[]; vision: Record<string, string>
  rewards: { t: string; area: string }[]
  words: string[]; who: string[]
  metas: Meta[]; items: Item[]
  ideas: string[]
  newCycleId?: string; weeks?: number; start?: string; finished?: boolean
}
const empty = (): RT => ({ v: 2, step: 0, sub: 0, reflect: [], created: [], refl: {}, focus: [], vision: {}, rewards: [], words: [], who: [], metas: [], items: [], ideas: [] })
const blankRefl = (): AreaRefl => ({ score: null, good: [], bad: [], improve: [] })
const fmtNota = (n: number) => String(n).replace('.', ',')
const uid = () => Math.random().toString(36).slice(2, 10)

const P1 = RITUAL_P1, P2 = RITUAL_P2, P3 = RITUAL_P3, ORDER = RITUAL_ORDER, NAMES = RITUAL_NAMES
export const KIND_NAME: Record<Kind, string> = { habit: 'Hábito', project: 'Projeto', both: 'Mix' }
const TYPE_NAME: Record<ItemType, string> = { projeto: 'Projeto', habito: 'Hábito', tarefa: 'Tarefa', evento: 'Evento' }
const DAYS = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S']

// ---------------------------------------------------------------- página
export function Trimestre() {
  const nav = useNavigate()
  const { toast } = useOutletContext<ShellCtx>()
  const { profile } = useAuth()
  const { settings: appSettings } = useApp()
  const { rows: cycles, loading } = useRows<Cycle>('cycles', { order: { column: 'starts_on', ascending: false } })
  const { rows: refl } = useRows<Reflection>('reflections', { eq: { kind: 'reset' } })
  const { rows: areasAll } = useRows<Area>('areas', { order: { column: 'position' } })
  const areas = areasAll.filter((a) => !a.archived)
  const { rows: goals } = useRows<Goal>('goals')
  const { rows: steps } = useRows<Step>('steps')

  const row = refl.filter((r) => r.prompt === 'ritual-trimestre').find((r) => { try { const j = JSON.parse(r.answers[0] ?? '{}'); return !j.finished } catch { return false } })
  const saved = useMemo<RT | null>(() => {
    try { const j = row ? JSON.parse(row.answers[0]) : null; return j && j.v === 2 ? { ...empty(), ...j } : null } catch { return null }
  }, [row])
  const [st, setSt] = useState<RT | null>(null)
  const s = st ?? saved ?? empty()
  const sRef = useRef(s); sRef.current = s
  const set = (p: Partial<RT>) => setSt({ ...sRef.current, ...p })
  const rowId = useRef<string | null>(null)
  rowId.current = row?.id ?? rowId.current
  const [busy, setBusy] = useState(false)

  const newCycle = cycles.find((c) => c.id === s.newCycleId)
  const old = currentCycle(cycles.filter((c) => c.id !== s.newCycleId))
  const oldGoals = goals.filter((g) => g.cycle_id === old?.id)
  const oldSteps = steps.filter((x) => oldGoals.some((g) => g.id === x.goal_id))

  // guarda sozinho, um pouco depois de cada mudança (dá para pausar e voltar)
  const discarded = useRef(false)
  async function saveNow(state: RT) {
    if (discarded.current) return
    const body = { answers: [JSON.stringify(state)], title: 'Ritual do ciclo' }
    if (rowId.current) await update<Reflection>('reflections', rowId.current, body)
    else { const r = await insert<Reflection>('reflections', { cycle_id: old?.id ?? null, kind: 'reset', week: null, prompt: 'ritual-trimestre', score: null, ...body }); rowId.current = r.id }
  }
  useEffect(() => {
    if (!st) return
    const t = setTimeout(() => { saveNow(st) }, 500)
    return () => clearTimeout(t)
  }, [st]) // eslint-disable-line react-hooks/exhaustive-deps
  const [cancelling, setCancelling] = useState(false)
  async function saveAndLeave() {
    try { await saveNow(sRef.current); toast('Ritual guardado. Continue de onde parou quando quiser.') } catch { toast('Não deu para guardar agora. Tente de novo.'); return }
    nav('/ciclo')
  }
  async function discard() {
    discarded.current = true
    const cur = sRef.current
    try {
      if (rowId.current) await remove('reflections', rowId.current)
      for (const k of cur.created) await update<Area>('areas', k, { archived: true, focus: false })
      const planning = cycles.find((c) => c.id === cur.newCycleId && c.status === 'planning')
      if (planning) await remove('cycles', planning.id)
      toast('Criação do ciclo cancelada.')
      nav('/ciclo')
    } catch { discarded.current = false; toast('Não deu para cancelar agora. Tente de novo.') }
  }

  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>
  const id = ORDER[s.step]
  const areaOf = (k: string) => areas.find((a) => a.id === k)
  const reflectAreas = s.reflect.map(areaOf).filter((a): a is Area => !!a)
  const focusAreas = s.focus.map(areaOf).filter((a): a is Area => !!a)
  const subList = id === 'reflexao' ? reflectAreas : id === 'metas' ? focusAreas : []
  const go = (step: number, sub = 0) => { set({ step: Math.max(0, Math.min(ORDER.length - 1, step)), sub }); window.scrollTo({ top: 0 }) }
  const next = () => (subList.length && s.sub < subList.length - 1 ? go(s.step, s.sub + 1) : go(s.step + 1))
  const back = () => (subList.length && s.sub > 0 ? go(s.step, s.sub - 1) : (() => { const p = ORDER[s.step - 1]; const n = p === 'reflexao' ? reflectAreas.length : p === 'metas' ? focusAreas.length : 1; go(s.step - 1, Math.max(0, n - 1)) })())
  const part = P1.includes(id) ? 1 : P2.includes(id) ? 2 : P3.includes(id) ? 3 : 0

  // o próximo ciclo: começa quando o atual acaba (ou na próxima semana)
  const defStart = () => {
    const base = old ? addDays(fromYmd(old.ends_on), 1) : addDays(weekStart(new Date(), profile?.week_starts_on ?? 1), 7)
    return ymd(base < new Date() ? addDays(weekStart(new Date(), profile?.week_starts_on ?? 1), 7) : base)
  }
  const nextStart = newCycle?.starts_on ?? s.start ?? defStart()
  const nextWeeks = newCycle ? execWeeks(newCycle) : s.weeks ?? appSettings.default_weeks
  const nextEnd = newCycleDates(nextStart, nextWeeks).ends_on
  async function setNext(p: { weeks?: number; start?: string }) {
    const w = p.weeks ?? nextWeeks, st0 = p.start ?? nextStart
    set({ weeks: w, start: st0 })
    if (newCycle) await update<Cycle>('cycles', newCycle.id, newCycleDates(st0, w))
  }

  // quanto cada área está preenchida (para o resumo e o rail)
  const filled = (k: string) => { const r = s.refl[k]; return !!r && (r.score != null || r.good.length > 0 || r.bad.length > 0 || r.improve.length > 0) }
  const itemsWeek = proposeWeeks(s.items, nextWeeks)

  async function finish() {
    if (busy) return
    setBusy(true)
    try {
      const d = fromYmd(nextStart)
      const c = newCycle ?? await insert<Cycle>('cycles', { name: `Q${Math.floor(d.getMonth() / 3) + 1} · ${d.getFullYear()}`, ...newCycleDates(nextStart, nextWeeks), status: 'planning', words: [], who_is_she: [] })
      if (!newCycle) set({ newCycleId: c.id })
      const weekDay = (w: number) => ymd(addDays(fromYmd(c.starts_on), (w - 1) * 7))
      // metas
      const gid: Record<string, string> = {}
      for (const [i, m] of s.metas.filter((x) => x.t.trim() && s.focus.includes(x.area)).entries()) {
        const g = await insert<Goal>('goals', { cycle_id: c.id, area_id: m.area, title: m.t.trim().slice(0, 200), done_definition: m.done.trim().slice(0, 500) || null, kind: m.kind, position: i })
        gid[m.id] = g.id
      }
      // projetos viram passos nas semanas; tarefas, hábitos e eventos vão para os seus lugares
      for (const [i, it] of itemsWeek.filter((x) => x.t.trim() && s.focus.includes(x.area)).entries()) {
        const title = it.t.trim().slice(0, 200)
        const g = it.meta ? gid[it.meta] : undefined
        if (it.type === 'projeto' && g) await insert<Step>('steps', { goal_id: g, title, week: it.week ?? 1, detail: null, position: i })
        else if (it.type === 'habito') await insert<Habit>('habits', { title: title.slice(0, 120), area_id: it.area, days: it.days?.length ? it.days : [0, 1, 2, 3, 4, 5, 6], archived: false })
        else if (it.type === 'evento' && it.date) await insert<CalEvent>('events', { title, starts_at: toIso(it.date), ends_at: toIso(ymd(addDays(fromYmd(it.date), 1))), all_day: true, kind: 'appointment', area_id: it.area, location: null, notes: null, reminder_minutes: null })
        else await insert<Task>('tasks', { title, notes: null, list_id: null, important: false, position: 0, area_id: it.area, due_on: weekDay(it.week ?? 1) })
      }
      // áreas: nota, melhorias, visão e foco
      for (const a of areas) {
        const r = s.refl[a.id]
        const patch: Partial<Area> = { focus: s.focus.includes(a.id) }
        if (r?.score != null) patch.score_now = r.score
        if (r?.improve.length) patch.improve = r.improve.join('. ').slice(0, 2000)
        if (s.focus.includes(a.id)) patch.why = (s.vision[a.id] ?? '').trim().slice(0, 2000) || null
        if (s.created.includes(a.id) && !s.reflect.includes(a.id)) patch.archived = true
        await update<Area>('areas', a.id, patch)
      }
      const base = { status: 'active' as const, words: s.words.slice(0, 10), who_is_she: s.who.slice(0, 20) }
      try { await update<Cycle>('cycles', c.id, { ...base, rewards: s.rewards.filter((r) => s.focus.includes(r.area)), ideas: s.ideas.slice(0, 60) }) }
      catch { await update<Cycle>('cycles', c.id, base) } // banco ainda sem as colunas novas: guarda o resto
      if (old && old.id !== c.id) await update<Cycle>('cycles', old.id, { status: 'closed' })
      const fin = { ...s, newCycleId: c.id, finished: true }
      if (rowId.current) await update<Reflection>('reflections', rowId.current, { answers: [JSON.stringify(fin)] })
      toast(`${c.name} começou. Bom ciclo!`)
      nav('/ciclo')
    } catch (e) {
      toast(`Não deu para começar o ciclo: ${e instanceof Error ? e.message : 'erro'}`)
    }
    setBusy(false)
  }

  const avgScore = (() => { const w = Array.from({ length: execWeeks(old) }, (_, i) => score(oldSteps.filter((x) => x.week === i + 1))).filter((v): v is number => v != null); return w.length ? Math.round(w.reduce((a, b) => a + b, 0) / w.length) : null })()
  const metGoals = oldGoals.filter((g) => { const x = oldSteps.filter((y) => y.goal_id === g.id); return x.length > 0 && x.every((y) => y.done_at) }).length
  const cur = subList[s.sub]
  // palavras do ciclo: aceita várias de uma vez, separadas por vírgula; guarda até 3
  const addWords = (text: string) => {
    const next = [...sRef.current.words]
    for (const w of text.split(',').map((x) => x.trim().slice(0, 60)).filter(Boolean)) if (next.length < 3 && !next.some((x) => x.toLowerCase() === w.toLowerCase())) next.push(w)
    if (next.length !== sRef.current.words.length) set({ words: next })
  }

  return (
    <div className="page wide ritual-page solo">

      <section className="stack ritual-main">
        <div className="row between">
          <span className="mono muted">{part ? `Parte ${part} de 3 · ${NAMES[id]}${cur ? ` · ${cur.name}, ${s.sub + 1} de ${subList.length}` : ''}` : 'Início'}</span>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn ghost small" onClick={saveAndLeave}><Icon name="download" size={14} />Guardar e sair</button>
            <button className="btn ghost small" onClick={() => setCancelling(true)}><Icon name="x" size={14} />Cancelar ciclo</button>
          </div>
        </div>
        {part > 0 && <div className="ritual-bar" aria-hidden><span style={{ width: `${Math.round((s.step / (ORDER.length - 1)) * 100)}%` }} /></div>}

        {id === 'inicio' && (
          <div className="stack">
            {old && <span className="mono muted">{weekOf(old) >= totalWeeks(old) ? `semana de revisão · ${fmt(addDays(fromYmd(old.ends_on), -6), 'd MMM')} a ${fmt(fromYmd(old.ends_on), 'd MMM')}` : old.name}</span>}
            <h1 className="serif-title" style={{ fontSize: 40, lineHeight: '44px' }}>{old ? `O ciclo ${old.name} ${weekOf(old) > execWeeks(old) ? 'terminou' : 'está acabando'}. Hora de olhar para trás e desenhar o próximo.` : 'Hora de desenhar o seu próximo ciclo.'}</h1>
            {old && (
              <div className="habit-stats">
                <div className="card stack" style={{ gap: 0 }}><span className="big">{execWeeks(old)}</span><span className="caption muted">semanas</span></div>
                <div className="card stack" style={{ gap: 0 }}><span className="big">{avgScore == null ? '–' : `${avgScore}%`}</span><span className="caption muted">placar médio</span></div>
                <div className="card stack" style={{ gap: 0 }}><span className="big">{metGoals} de {oldGoals.length}</span><span className="caption muted">metas</span></div>
              </div>
            )}
            <span className="mono muted">O ritual · 3 partes, no seu ritmo</span>
            <div className="card flush list">
              {[['Olhar para trás', 'Cada área: o que funcionou, o que não funcionou e o que melhorar'], ['Decidir', 'Áreas de foco, o que você quer TER, recompensas, 3 palavras, metas e projetos'], ['Organizar', 'Datas do ciclo, lista de ideias e a distribuição pelas semanas']].map(([t, h], i) => (
                <div key={t} className="list-row"><span className="ritual-num">{i + 1}</span><div className="stack" style={{ gap: 0 }}><span className="medium">{t}</span><span className="caption muted">{h}</span></div></div>
              ))}
            </div>
            <span className="mono muted" style={{ marginTop: 8 }}>O próximo ciclo</span>
            <DurationPicker weeks={nextWeeks} start={nextStart} onChange={(w) => setNext({ weeks: w })} />
            <label className="field"><span>Começa em</span><input className="input" type="date" value={nextStart} onChange={(e) => e.target.value && setNext({ start: e.target.value })} /></label>
          </div>
        )}

        {id === 'areas' && <AreasPick areas={areas} s={s} set={set} />}

        {id === 'reflexao' && (cur ? <Reflect key={cur.id} area={cur} r={s.refl[cur.id] ?? blankRefl()} onChange={(r) => set({ refl: { ...s.refl, [cur.id]: r } })} />
          : <Empty>Escolha pelo menos uma área na etapa anterior.</Empty>)}

        {id === 'foco' && <Foco areas={reflectAreas} s={s} set={set} />}

        {id === 'tipos' && <Tipos />}

        {id === 'recompensas' && (
          <div className="stack">
            <h1 className="serif-title">Como você vai comemorar?</h1>
            <p className="muted" style={{ margin: 0 }}>Pelo menos uma recompensa por área de foco. Sem ser só comida.</p>
            {focusAreas.length ? focusAreas.map((a) => {
              const mine = s.rewards.filter((r) => r.area === a.id).map((r) => r.t)
              return (
                <div key={a.id} className="stack" style={{ gap: 6 }}>
                  <span className="row" style={{ gap: 8 }}><AreaIcon area={a} size={24} /><span className="medium grow">{a.name}</span>{!mine.length && <span className="caption muted">falta 1</span>}</span>
                  <ListInput label={`Recompensas de ${a.name}`} items={mine} max={6} placeholder="Ex.: um jantar no meu restaurante favorito"
                    onChange={(v) => set({ rewards: [...s.rewards.filter((r) => r.area !== a.id), ...v.map((t) => ({ t, area: a.id }))] })} />
                </div>
              )
            }) : <Empty>Escolha as áreas de foco primeiro.</Empty>}
          </div>
        )}

        {id === 'palavras' && (
          <div className="stack">
            <h1 className="serif-title">3 palavras para inspirar este ciclo</h1>
            <div className="wordchips">{s.words.map((w) => <button key={w} onClick={() => set({ words: s.words.filter((x) => x !== w) })} aria-label={`Tirar ${w}`}>{w} ✕</button>)}</div>
            {s.words.length < 3 && <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('w') as HTMLInputElement; addWords(f.value); f.value = '' }}>
              <input name="w" className="input" placeholder={s.words.length ? ['coragem', 'constância', 'leveza'][s.words.length] : 'Escreva e aperte Enter (ou separe por vírgula)'} maxLength={200} aria-label="Palavras do ciclo"
                onChange={(e) => { const v = e.target.value; if (v.includes(',')) { const i = v.lastIndexOf(','); addWords(v.slice(0, i)); e.target.value = v.slice(i + 1).trimStart() } }}
                onBlur={(e) => { if (e.target.value.trim()) { addWords(e.target.value); e.target.value = '' } }} /></form>}
            <span className="caption muted">Pode ser palavra ou expressão, do tamanho que quiser.</span>
            {cycles.some((c) => c.id !== s.newCycleId && c.words.length) && <>
              <span className="mono muted">Ciclos anteriores</span>
              <div className="card flush list">{cycles.filter((c) => c.id !== s.newCycleId && c.words.length).slice(0, 4).map((c) => <div key={c.id} className="list-row"><span className="mono muted" style={{ width: 80 }}>{c.name}</span><span>{c.words.join(' · ')}</span></div>)}</div>
            </>}
            <span className="serif" style={{ fontSize: 28, marginTop: 12 }}>Who is she?</span>
            <p className="muted" style={{ margin: 0 }}>Como você quer se ver no fim do ciclo. Frases curtas, no presente.</p>
            <ListInput label="Who is she" items={s.who} onChange={(v) => set({ who: v })} placeholder="Ela…" max={20} />
          </div>
        )}

        {id === 'metas' && (cur ? <MetasArea key={cur.id} area={cur} vision={s.vision[cur.id] ?? ''} s={s} set={set} />
          : <Empty>Escolha as áreas de foco primeiro.</Empty>)}

        {id === 'datas' && <Datas from={nextStart} to={nextEnd} weeks={nextWeeks} />}

        {id === 'ideias' && (
          <div className="stack">
            <h1 className="serif-title">Ideias para o ciclo</h1>
            <p className="muted" style={{ margin: 0 }}>Eventos para pensar em ir, coisas legais para fazer, comprinhas. É a sua lista de prêmios: quando uma semana fechar com 85% ou mais, o app sugere uma delas.</p>
            <ListInput label="Ideias" items={s.ideas} onChange={(v) => set({ ideas: v })} max={60} placeholder="Ex.: run club, aula de cerâmica, feira ecológica" />
          </div>
        )}

        {id === 'distribuir' && <Distribuir s={s} set={set} areas={areas} items={itemsWeek} weeks={nextWeeks} start={nextStart} busy={busy} onFinish={finish} reflected={s.reflect.filter(filled).length} />}

        {id !== 'distribuir' && (
          <div className="row between" style={{ marginTop: 8 }}>
            {s.step > 0 ? <button className="btn secondary" onClick={back}>Voltar</button> : <span />}
            <button className="btn primary" onClick={() => {
              if (id === 'inicio' && !s.reflect.length) { set({ reflect: areas.map((a) => a.id), step: 1, sub: 0 }); window.scrollTo({ top: 0 }); return }
              if (id === 'foco') set({ focus: s.focus.filter((k) => s.reflect.includes(k)) })
              next()
            }}>{id === 'inicio' ? 'Começar' : id === 'reflexao' && s.sub < subList.length - 1 ? 'Próxima área' : id === 'metas' && s.sub < subList.length - 1 ? 'Próxima área' : 'Continuar'}</button>
          </div>
        )}
      </section>

      <Sheet open={cancelling} onClose={() => setCancelling(false)} title="Cancelar a criação do ciclo?" labelledBy="cancel-ritual">
        <div className="stack" style={{ gap: 12 }}>
          <p style={{ margin: 0 }}>Tudo o que você escreveu neste ritual é apagado: reflexões das áreas, foco, recompensas, palavras, metas, projetos e ideias. Não dá para desfazer.</p>
          <p className="caption muted" style={{ margin: 0 }}>{old ? `O ciclo ${old.name} continua como está. ` : ''}Áreas que você criou aqui saem do menu. Datas que você adicionou à agenda ficam na Agenda.</p>
          <button className="btn primary block" onClick={() => { setCancelling(false); saveAndLeave() }}>Guardar para continuar depois</button>
          <button className="btn block" style={{ color: 'var(--danger)', boxShadow: 'inset 0 0 0 1px var(--danger)' }} onClick={discard}>Apagar e cancelar</button>
        </div>
      </Sheet>
    </div>
  )
}

/** Semana proposta para cada projeto e tarefa sem semana: espalha os de cada área pelo ciclo. Eventos ficam na semana da data. */
function proposeWeeks(items: Item[], weeks: number): Item[] {
  const byArea: Record<string, Item[]> = {}
  for (const it of items) if ((it.type === 'projeto' || it.type === 'tarefa') && !it.week) (byArea[it.area] ??= []).push(it)
  const auto: Record<string, number> = {}
  for (const list of Object.values(byArea)) list.forEach((it, i) => { auto[it.id] = Math.min(weeks, 1 + Math.floor((i * weeks) / list.length)) })
  return items.map((it) => (auto[it.id] ? { ...it, week: auto[it.id] } : it))
}

// ---------------------------------------------------------------- etapas
function AreasPick({ areas, s, set }: { areas: Area[]; s: RT; set: (p: Partial<RT>) => void }) {
  const [busy, setBusy] = useState('')
  const known = new Set(AREA_CATALOG.map((p) => presetArea(p, areas)?.id).filter(Boolean))
  // repetidas: outra área que cai na mesma opção do catálogo (ex.: "Self improvement" e "Eu")
  const dup = (a: Area) => !known.has(a.id) && !a.is_fixed && AREA_CATALOG.some((p) => p.match.test(normName(a.name)))
  const mine = areas.filter((a) => !known.has(a.id) && !dup(a))
  // as repetidas que este ritual criou e você não escolheu saem do menu
  useEffect(() => {
    for (const a of areas) if (dup(a) && s.created.includes(a.id) && !s.reflect.includes(a.id)) update<Area>('areas', a.id, { archived: true, focus: false }).catch(() => {})
  }, [areas.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (a: Area) => set({ reflect: s.reflect.includes(a.id) ? s.reflect.filter((x) => x !== a.id) : [...s.reflect, a.id] })
  const create = async (key: string) => {
    const p = AREA_CATALOG.find((x) => x.key === key)!
    setBusy(key)
    try {
      const a = await insert<Area>('areas', { name: p.name, color: p.color, icon: p.icon, position: Math.max(0, ...areas.map((x) => x.position)) + 1, is_fixed: false, focus: false, archived: false })
      set({ reflect: [...s.reflect, a.id], created: [...s.created, a.id] })
    } catch { /* fica sem marcar */ }
    setBusy('')
  }
  const card = (a: Area | null, p: { key: string; name: string; color: Area['color']; icon: string; hint?: string }) => {
    const on = !!a && s.reflect.includes(a.id)
    return (
      <button key={a?.id ?? p.key} className={'area-card' + (on ? ' on' : '')} aria-pressed={on} disabled={busy === p.key}
        style={on ? { background: `var(--${p.color}-bg)`, color: `var(--${p.color}-fg)` } : undefined}
        onClick={() => (a ? toggle(a) : create(p.key))}>
        <div className="row between"><AreaIcon area={{ color: p.color, icon: p.icon }} size={30} />{on && <Icon name="check" size={16} />}</div>
        <span className="medium">{p.name}</span>
        {p.hint && <span className="caption" style={{ opacity: 0.8 }}>{p.hint}</span>}
      </button>
    )
  }
  return (
    <div className="stack">
      <h1 className="serif-title">Quais áreas da sua vida você quer avaliar?</h1>
      <p className="muted" style={{ margin: 0 }}>Escolha quantas fizerem sentido. Em cada uma você vai dar uma nota e pensar no que funcionou, no que não funcionou e no que melhorar.</p>
      <div className="card soft caption"><b>Aqui ainda não é o foco.</b> Esta escolha é só para olhar para trás: avaliar o último ciclo e como está cada parte da vida. As áreas de foco do próximo ciclo você escolhe depois, na parte 2, já com essa avaliação na mão.</div>
      <div className="area-pick">
        {mine.map((a) => card(a, { ...a, key: a.id }))}
        {AREA_CATALOG.map((p) => { const a = presetArea(p, areas); return card(a ?? null, a ? { ...p, name: a.name, color: a.color, icon: a.icon } : p) })}
      </div>
      <span className="caption muted">{s.reflect.length} área{s.reflect.length === 1 ? '' : 's'} para refletir</span>
    </div>
  )
}

function PairList({ items, onChange, max, a, b, label }: { items: { t: string; x: string }[]; onChange: (v: { t: string; x: string }[]) => void; max: number; a: string; b: string; label: string }) {
  const [t, setT] = useState(''); const [x, setX] = useState('')
  const add = () => { if (!t.trim() || items.length >= max) return; onChange([...items, { t: t.trim(), x: x.trim() }]); setT(''); setX('') }
  return (
    <div className="card flush list" aria-label={label}>
      {items.map((it, i) => (
        <div key={`${i}-${it.t}-${it.x}`} className="list-row pair-row">
          <span className="li-dot" aria-hidden />
          <div className="grow stack" style={{ gap: 2 }}>
            <input className="input bare" defaultValue={it.t} maxLength={200} aria-label={`${label} ${i + 1}`} onBlur={(e) => { const v = e.target.value.trim(); const n = [...items]; if (v) n[i] = { ...it, t: v }; else n.splice(i, 1); onChange(n) }} />
            {it.x && <input className="input bare caption muted" defaultValue={it.x} maxLength={300} aria-label={`${b} ${i + 1}`} onBlur={(e) => { const n = [...items]; n[i] = { ...it, x: e.target.value.trim() }; onChange(n) }} />}
          </div>
          <button className="faint" aria-label="Tirar" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
        </div>
      ))}
      {items.length < max && (
        <form className="list-row pair-row" onSubmit={(e) => { e.preventDefault(); add() }}>
          <Icon name="plus" size={16} className="faint" />
          <div className="grow stack" style={{ gap: 2 }}>
            <input className="input bare" value={t} maxLength={200} placeholder={a} onChange={(e) => setT(e.target.value)} aria-label={`Nova linha: ${label}`} />
          </div>
          {t.trim() && <button className="btn secondary small">Adicionar</button>}
        </form>
      )}
    </div>
  )
}

function Reflect({ area, r, onChange }: { area: Area; r: AreaRefl; onChange: (r: AreaRefl) => void }) {
  const set = (p: Partial<AreaRefl>) => onChange({ ...r, ...p })
  return (
    <div className="stack">
      <div className="row" style={{ gap: 12 }}><AreaIcon area={area} size={40} /><h1 className="serif-title" style={{ margin: 0 }}>{area.name}</h1></div>
      <div className="nota-slider">
        <div className="row between" style={{ alignItems: 'baseline' }}>
          <span className="mono muted">Nota de 0 a 10 no último ciclo{area.score_now != null ? ` · antes: ${fmtNota(Number(area.score_now))}` : ''}</span>
          <span className="serif nota-val">{r.score == null ? '–' : fmtNota(r.score)}</span>
        </div>
        <input type="range" min={0} max={10} step={0.5} value={r.score ?? 5} className={'nota-range' + (r.score == null ? ' unset' : '')}
          style={{ ['--p' as string]: `${((r.score ?? 5) / 10) * 100}%` }}
          aria-label={`Nota de ${area.name}`} aria-valuetext={r.score == null ? 'sem nota' : fmtNota(r.score)}
          onChange={(e) => set({ score: Number(e.target.value) })}
          onPointerUp={(e) => r.score == null && set({ score: Number(e.currentTarget.value) })}
          onKeyUp={(e) => r.score == null && set({ score: Number(e.currentTarget.value) })} />
        <div className="row between caption muted"><span>0</span><span>5</span><span>10</span></div>
        {r.score == null ? <span className="caption muted">Arraste para dar a nota.</span>
          : <button className="caption muted" style={{ alignSelf: 'flex-start' }} onClick={() => set({ score: null })}>Tirar a nota</button>}
      </div>
      <span className="mono muted">O que funcionou, e como · até 4</span>
      <PairList label="O que funcionou" max={4} a="Ex.: caminhar de manhã, deixando o tênis na porta" b="Como?"
        items={r.good.map((g) => ({ t: g.t, x: g.how }))} onChange={(v) => set({ good: v.map((g) => ({ t: g.t, how: g.x })) })} />
      <span className="mono muted">O que não funcionou, e por quê</span>
      <PairList label="O que não funcionou" max={12} a="Ex.: estudar à noite, porque chegava cansada" b="Por quê?"
        items={r.bad.map((g) => ({ t: g.t, x: g.why }))} onChange={(v) => set({ bad: v.map((g) => ({ t: g.t, why: g.x })) })} />
      <span className="mono muted">Melhorias para o próximo ciclo</span>
      <ListInput label={`Melhorias em ${area.name}`} items={r.improve} max={10} placeholder="Ex.: estudar de manhã, antes do trabalho" onChange={(v) => set({ improve: v })} />
      <span className="caption muted">Pode deixar em branco o que não fizer sentido.</span>
    </div>
  )
}

function Foco({ areas, s, set }: { areas: Area[]; s: RT; set: (p: Partial<RT>) => void }) {
  const n = s.focus.length
  return (
    <div className="stack">
      <h1 className="serif-title">Em quais áreas você vai focar neste ciclo?</h1>
      <p className="muted" style={{ margin: 0 }}>A recomendação é até 4. As outras continuam no app, guardadas em “Outras áreas”, sem metas neste ciclo.</p>
      <div className="area-pick">
        {areas.map((a) => {
          const on = s.focus.includes(a.id); const r = s.refl[a.id]
          return <button key={a.id} className={'area-card' + (on ? ' on' : '')} aria-pressed={on}
            style={on ? { background: `var(--${a.color}-bg)`, color: `var(--${a.color}-fg)` } : undefined}
            onClick={() => set({ focus: on ? s.focus.filter((x) => x !== a.id) : [...s.focus, a.id] })}>
            <div className="row between"><AreaIcon area={a} size={30} />{on ? <Icon name="check" size={16} /> : r?.score != null && <span className="mono caption">{fmtNota(r.score)}/10</span>}</div>
            <span className="medium">{a.name}</span>
            {r?.improve[0] && <span className="caption" style={{ opacity: 0.8 }}>{r.improve[0]}</span>}
          </button>
        })}
      </div>
      <span className="caption muted">{n} escolhida{n === 1 ? '' : 's'}</span>
      {n > 4 && <div className="card soft caption"><b>São {n} áreas.</b> No 12 Week Year, mais de 4 focos costuma virar ruído: a atenção se espalha e as coisas pequenas de cada semana ficam para trás. Se puder, deixe só as que mais importam agora.</div>}
      {s.focus.map((k) => areas.find((a) => a.id === k)).filter((a): a is Area => !!a).map((a) => (
        <label key={a.id} className="field">
          <span className="row" style={{ gap: 8 }}><AreaIcon area={a} size={22} />{a.name}: no fim do ciclo eu quero TER…</span>
          <textarea className="input" rows={2} maxLength={500} value={s.vision[a.id] ?? ''} placeholder={VISION_HINTS[a.color] ?? 'Ex.: feito aquilo que eu adio há meses'}
            onChange={(e) => set({ vision: { ...s.vision, [a.id]: e.target.value } })} />
        </label>
      ))}
    </div>
  )
}
const VISION_HINTS: Partial<Record<Area['color'], string>> = {
  trabalho: 'Ex.: encontrado um emprego que eu amo', relacoes: 'Ex.: amigos em quem eu confio de verdade', saude: 'Ex.: conseguido ficar menos ansiosa falando com pessoas',
  estudos: 'Ex.: enviado todas as candidaturas do mestrado', financas: 'Ex.: uma reserva de 3 meses guardada', eu: 'Ex.: um hobby que é só meu',
}

function Tipos() {
  const cards: [string, string, string, string][] = [
    ['Hábito', 'repeat', 'Algo que se repete. O resultado vem da constância, não de uma entrega.', 'Caminhar 3x por semana · journal diário · ligar para a vó todo domingo'],
    ['Projeto', 'target', 'Tem começo e fim. É uma sequência de passos que termina numa entrega.', 'Montar o portfólio · enviar a candidatura do mestrado · organizar a viagem'],
    ['Mix', 'growth', 'Um projeto que depende de um hábito para acontecer.', 'Correr 10 km: treinar 3x por semana (hábito) e se inscrever na prova (projeto)'],
  ]
  return (
    <div className="stack">
      <h1 className="serif-title">Hábito, projeto ou os dois?</h1>
      <p className="muted" style={{ margin: 0 }}>Antes das metas, uma diferença que ajuda a planejar. Cada meta vai ganhar uma destas etiquetas.</p>
      {cards.map(([t, ic, d, ex]) => (
        <div key={t} className="card stack" style={{ gap: 6 }}>
          <span className="row" style={{ gap: 8 }}><span className="owner-ico"><Icon name={ic} size={16} /></span><span className="serif" style={{ fontSize: 26 }}>{t}</span></span>
          <span>{d}</span>
          <span className="caption muted">{ex}</span>
        </div>
      ))}
      <div className="card soft caption">O caminho completo: o que você quer <b>TER</b> é a visão da área; as <b>metas</b> são os resultados que levam até lá; <b>projetos e hábitos</b> são o que você faz para chegar nas metas; as <b>tarefas</b> são os passos de cada semana.</div>
    </div>
  )
}

function MetasArea({ area, vision, s, set }: { area: Area; vision: string; s: RT; set: (p: Partial<RT>) => void }) {
  const metas = s.metas.filter((m) => m.area === area.id)
  const items = s.items.filter((i) => i.area === area.id)
  const setMeta = (id: string, p: Partial<Meta>) => set({ metas: s.metas.map((m) => (m.id === id ? { ...m, ...p } : m)) })
  const setItem = (id: string, p: Partial<Item>) => set({ items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) })
  const [t, setT] = useState(''); const [type, setType] = useState<ItemType>('projeto')
  const [mt, setMt] = useState('')
  const addMeta = () => { if (!mt.trim()) return; set({ metas: [...s.metas, { id: uid(), area: area.id, t: mt.trim(), kind: 'project', done: '' }] }); setMt('') }
  const addItem = () => { if (!t.trim()) return; set({ items: [...s.items, { id: uid(), area: area.id, meta: metas[metas.length - 1]?.id ?? null, t: t.trim(), type, days: type === 'habito' ? [1, 3, 5] : undefined }] }); setT('') }
  return (
    <div className="stack">
      <div className="row" style={{ gap: 12 }}><AreaIcon area={area} size={40} /><h1 className="serif-title" style={{ margin: 0 }}>{area.name}</h1></div>
      {vision.trim() && <p className="serif" style={{ fontSize: 22, lineHeight: '28px', margin: 0 }}>“Quero ter {vision.trim().replace(/^quero ter\s*/i, '').replace(/[.]+$/, '')}.”</p>}

      <span className="mono muted">Metas principais</span>
      {metas.map((m) => (
        <div key={m.id} className="card stack" style={{ gap: 8 }}>
          <div className="row" style={{ gap: 8 }}>
            <input className="input bare grow medium" defaultValue={m.t} maxLength={200} aria-label="Meta" onBlur={(e) => setMeta(m.id, { t: e.target.value })} />
            <button className="faint" aria-label={`Tirar ${m.t}`} onClick={() => set({ metas: s.metas.filter((x) => x.id !== m.id), items: s.items.map((i) => (i.meta === m.id ? { ...i, meta: null } : i)) })}><Icon name="x" size={14} /></button>
          </div>
          <div className="dur-options" role="radiogroup" aria-label="Tipo da meta">
            {(['habit', 'project', 'both'] as Kind[]).map((k) => <button key={k} type="button" role="radio" aria-checked={m.kind === k} className={'dur-opt small' + (m.kind === k ? ' on' : '')} onClick={() => setMeta(m.id, { kind: k })}>{KIND_NAME[k]}</button>)}
          </div>
          <input className="input" defaultValue={m.done} maxLength={500} placeholder="Está pronta quando… (ex.: 3 candidaturas enviadas)" aria-label="Quando a meta está pronta" onBlur={(e) => setMeta(m.id, { done: e.target.value })} />
        </div>
      ))}
      <form className="card row" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); addMeta() }}>
        <Icon name="plus" size={16} className="faint" />
        <input className="input bare grow" value={mt} maxLength={200} placeholder="Nova meta (o resultado final)" onChange={(e) => setMt(e.target.value)} aria-label="Nova meta" />
        {mt.trim() && <button className="btn secondary small">Adicionar</button>}
      </form>
      {metas.length > 3 && <span className="caption muted">Mais de 3 metas numa área costuma ser muito para um ciclo.</span>}

      <span className="mono muted" style={{ marginTop: 8 }}>Projetos, hábitos e o que fazer</span>
      <p className="caption muted" style={{ margin: 0 }}>Cada item ganha um tipo agora. No fim do ritual o app propõe em que semana cada um entra.</p>
      {items.length > 0 && (
        <div className="card flush list">
          {items.map((it) => (
            <div key={it.id} className="list-row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
              <span className="tag-pill">{TYPE_NAME[it.type]}</span>
              <input className="input bare grow" style={{ minWidth: 160 }} defaultValue={it.t} maxLength={200} aria-label="Item" onBlur={(e) => setItem(it.id, { t: e.target.value })} />
              <select className="input" style={{ width: 'auto' }} value={it.type} aria-label="Tipo" onChange={(e) => { const v = e.target.value as ItemType; setItem(it.id, { type: v, days: v === 'habito' ? it.days ?? [1, 3, 5] : it.days }) }}>
                {(Object.keys(TYPE_NAME) as ItemType[]).map((k) => <option key={k} value={k}>{TYPE_NAME[k]}</option>)}
              </select>
              {metas.length > 0 && <select className="input" style={{ width: 'auto', maxWidth: 200 }} value={it.meta ?? ''} aria-label="Meta" onChange={(e) => setItem(it.id, { meta: e.target.value || null })}>
                <option value="">sem meta</option>{metas.map((m) => <option key={m.id} value={m.id}>{m.t}</option>)}
              </select>}
              {it.type === 'habito' && <div className="row" style={{ gap: 4, width: '100%' }} role="group" aria-label="Dias">
                {DAYS.map((d, i) => { const on = it.days?.includes(i); return <button key={i} type="button" aria-pressed={on} className={'nota small mono' + (on ? ' on' : '')} onClick={() => setItem(it.id, { days: on ? (it.days ?? []).filter((x) => x !== i) : [...(it.days ?? []), i].sort() })}>{d}</button> })}
              </div>}
              {it.type === 'evento' && <input type="date" className="input" style={{ width: 170 }} value={it.date ?? ''} aria-label="Dia do evento" onChange={(e) => setItem(it.id, { date: e.target.value || undefined })} />}
              {it.type === 'projeto' && !it.meta && <span className="caption muted" style={{ width: '100%' }}>Sem meta, este projeto entra como tarefa.</span>}
              <button className="faint" aria-label={`Tirar ${it.t}`} onClick={() => set({ items: s.items.filter((x) => x.id !== it.id) })}><Icon name="x" size={14} /></button>
            </div>
          ))}
        </div>
      )}
      <form className="card row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); addItem() }}>
        <Icon name="plus" size={16} className="faint" />
        <input className="input bare grow" style={{ minWidth: 160 }} value={t} maxLength={200} placeholder="Ex.: atualizar o portfólio" onChange={(e) => setT(e.target.value)} aria-label="Novo projeto, hábito, tarefa ou evento" />
        <select className="input" style={{ width: 'auto' }} value={type} aria-label="Tipo do item" onChange={(e) => setType(e.target.value as ItemType)}>
          {(Object.keys(TYPE_NAME) as ItemType[]).map((k) => <option key={k} value={k}>{TYPE_NAME[k]}</option>)}
        </select>
        <button className="btn secondary small" disabled={!t.trim()}>Adicionar</button>
      </form>
    </div>
  )
}

function Datas({ from, to, weeks }: { from: string; to: string; weeks: number }) {
  const { rows: events } = useRows<CalEvent>('events', { gte: { starts_at: toIso(from) }, lt: { starts_at: toIso(to) }, order: { column: 'starts_at' } })
  const [kind, setKind] = useState('Evento')
  const kindOf = (e: CalEvent) => /anivers/i.test(e.title) ? 'aniversário' : /feriado|dia d[aoe]s? |natal|carnaval|p[aá]scoa|ano novo|independ|rep[uú]blica|consci[eê]ncia|corpo de deus|finados|imaculada/i.test(e.title) ? 'feriado' : /viagem|f[eé]rias|voo|pausa/i.test(e.title) ? 'viagem' : e.all_day ? 'evento' : 'compromisso'
  const big = events.filter((e) => e.all_day || new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime() >= 3 * 3600e3 || /anivers|feriado|viagem|entrevista|apresenta|prova|exame/i.test(e.title))
  const weekOfDate = (d: Date) => Math.min(weeks + 1, Math.floor((d.getTime() - fromYmd(from).getTime()) / (7 * 86400e3)) + 1)
  const months: { key: string; label: string; list: CalEvent[] }[] = []
  for (let d = fromYmd(from); d <= fromYmd(to); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
    const key = fmt(d, 'yyyy-MM')
    months.push({ key, label: fmt(d, "MMMM 'de' yyyy"), list: big.filter((e) => fmt(new Date(e.starts_at), 'yyyy-MM') === key) })
  }
  const span = (e: CalEvent) => { const a = new Date(e.starts_at), b = new Date(new Date(e.ends_at).getTime() - (e.all_day ? 1 : 0)); return a.toDateString() === b.toDateString() ? fmt(a, 'd') : `${fmt(a, 'd')}–${fmt(b, 'd')}` }
  return (
    <div className="stack">
      <h1 className="serif-title">O que acontece neste ciclo?</h1>
      <p className="muted" style={{ margin: 0 }}>Eventos, feriados, viagens, aniversários e datas importantes, mês a mês. Vêm das agendas que você mostra no app (como os feriados que você assina no Google). Complete o que faltar para não esquecer nada.</p>
      {months.map((m) => (
        <div key={m.key} className="stack" style={{ gap: 6 }}>
          <span className="mono muted">{m.label}</span>
          {m.list.length ? (
            <div className="card flush list">
              {m.list.map((e) => (
                <div key={e.id} className="list-row">
                  <div className="date-chip"><span className="mono">{fmt(new Date(e.starts_at), 'EEE').toUpperCase()}</span><span className="medium">{span(e)}</span></div>
                  <div className="grow stack" style={{ gap: 0 }}><span>{e.title}</span><span className="caption muted">{kindOf(e)} · semana {weekOfDate(new Date(e.starts_at))}</span></div>
                </div>
              ))}
            </div>
          ) : <span className="caption muted">Nada marcado ainda.</span>}
        </div>
      ))}
      <form className="card row" style={{ flexWrap: 'wrap', gap: 8 }} onSubmit={async (e) => {
        e.preventDefault(); const f = e.currentTarget; const t = (f.elements.namedItem('t') as HTMLInputElement).value.trim(); const d = (f.elements.namedItem('d') as HTMLInputElement).value; if (!t || !d) return
        const title = kind === 'Aniversário' && !/anivers/i.test(t) ? `Aniversário: ${t}` : kind === 'Viagem' && !/viagem/i.test(t) ? `Viagem: ${t}` : t
        await insert<CalEvent>('events', { title, starts_at: toIso(d), ends_at: toIso(ymd(addDays(fromYmd(d), 1))), all_day: true, kind: 'appointment', area_id: null, location: null, notes: null, reminder_minutes: null }); f.reset()
      }}>
        <Icon name="plus" size={16} className="faint" />
        <select className="input" style={{ width: 'auto' }} value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Tipo da data">{['Evento', 'Aniversário', 'Viagem', 'Feriado'].map((k) => <option key={k}>{k}</option>)}</select>
        <input name="t" className="input grow" style={{ minWidth: 160 }} placeholder={kind === 'Aniversário' ? 'De quem?' : 'O que é?'} maxLength={120} aria-label="Nova data" />
        <input name="d" type="date" className="input" style={{ width: 160 }} aria-label="Dia" defaultValue={from} min={from} max={to} />
        <button className="btn secondary small">Adicionar</button>
      </form>
      <span className="caption muted">Aniversários que se repetem todo ano: marque como “anual” na Agenda depois, se a sua agenda do Google ainda não tiver.</span>
    </div>
  )
}

function Distribuir({ s, set, areas, items, weeks, start, busy, onFinish, reflected }: { s: RT; set: (p: Partial<RT>) => void; areas: Area[]; items: Item[]; weeks: number; start: string; busy: boolean; onFinish: () => void; reflected: number }) {
  const area = (k: string) => areas.find((a) => a.id === k)
  const live = items.filter((i) => i.t.trim() && s.focus.includes(i.area))
  const weekOfDate = (d: string) => Math.max(1, Math.min(weeks, Math.floor((fromYmd(d).getTime() - fromYmd(start).getTime()) / (7 * 86400e3)) + 1))
  const habits = live.filter((i) => i.type === 'habito')
  const dated = live.filter((i) => i.type !== 'habito')
  const setWeek = (id: string, w: number) => set({ items: s.items.map((i) => (i.id === id ? { ...i, week: w } : i)) })
  const typeOf = (i: Item) => (i.type === 'projeto' && !i.meta ? 'tarefa' : i.type === 'evento' && !i.date ? 'tarefa' : i.type)
  const metas = s.metas.filter((m) => m.t.trim() && s.focus.includes(m.area))
  return (
    <div className="stack">
      <h1 className="serif-title">Revisar e distribuir</h1>
      <p className="muted" style={{ margin: 0 }}>O app separou o que é meta, projeto, hábito, tarefa e evento e propôs uma semana para cada coisa. Mude o que quiser e comece o ciclo.</p>
      <div className="habit-stats">
        <div className="card stack" style={{ gap: 0 }}><span className="big">{s.focus.length}</span><span className="caption muted">áreas de foco · {reflected} refletidas</span></div>
        <div className="card stack" style={{ gap: 0 }}><span className="big">{metas.length}</span><span className="caption muted">metas</span></div>
        <div className="card stack" style={{ gap: 0 }}><span className="big">{weeks}</span><span className="caption muted">semanas · de {fmt(fromYmd(start), 'd MMM')}</span></div>
      </div>
      {metas.length > 0 && <>
        <span className="mono muted">Metas</span>
        <div className="card flush list">{metas.map((m) => <div key={m.id} className="list-row"><div className="grow stack" style={{ gap: 0 }}><span className="medium">{m.t}</span>{m.done && <span className="caption muted">pronta quando: {m.done}</span>}</div><span className="tag-pill">{KIND_NAME[m.kind]}</span><AreaTag area={area(m.area)} /></div>)}</div>
      </>}
      {habits.length > 0 && <>
        <span className="mono muted">Hábitos · toda semana</span>
        <div className="card flush list">{habits.map((h) => <div key={h.id} className="list-row"><span className="grow">{h.t}</span><span className="caption muted mono">{(h.days ?? []).map((d) => DAYS[d]).join(' ')}</span><AreaTag area={area(h.area)} /></div>)}</div>
      </>}
      {Array.from({ length: weeks }, (_, w) => w + 1).map((w) => {
        const list = dated.filter((i) => (i.type === 'evento' && i.date ? weekOfDate(i.date) : i.week ?? 1) === w)
        if (!list.length) return null
        return (
          <div key={w} className="stack" style={{ gap: 6 }}>
            <span className="mono muted">Semana {w} · {fmt(addDays(fromYmd(start), (w - 1) * 7), 'd MMM')}</span>
            <div className="card flush list">
              {list.map((i) => (
                <div key={i.id} className="list-row" style={{ flexWrap: 'wrap', rowGap: 6 }}>
                  <span className="tag-pill">{TYPE_NAME[typeOf(i)]}</span>
                  <span className="grow" style={{ minWidth: 140 }}>{i.t}</span>
                  <AreaTag area={area(i.area)} />
                  {i.type === 'evento' && i.date ? <span className="caption muted">{fmt(fromYmd(i.date), 'd MMM')}</span> : (
                    <select className="input" style={{ width: 'auto' }} value={i.week ?? 1} aria-label={`Semana de ${i.t}`} onChange={(e) => setWeek(i.id, Number(e.target.value))}>
                      {Array.from({ length: weeks }, (_, k) => <option key={k} value={k + 1}>Semana {k + 1}</option>)}
                    </select>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
      {!live.length && <Empty>Nenhum projeto, hábito, tarefa ou evento ainda. Volte em “Metas e projetos” para adicionar.</Empty>}
      {s.who.length > 0 && <p className="serif-title" style={{ fontSize: 26 }}>“{s.who.slice(0, 3).map((x) => x.replace(/[.;]+$/, '')).join('. ')}.”</p>}
      <div className="row between" style={{ marginTop: 8 }}>
        <button className="btn secondary" onClick={() => { set({ step: ORDER.indexOf('ideias'), sub: 0 }); window.scrollTo({ top: 0 }) }}>Voltar</button>
        <button className="btn primary" disabled={busy || !s.focus.length} onClick={onFinish}>{busy ? 'Organizando…' : 'Começar o ciclo'}</button>
      </div>
    </div>
  )
}
