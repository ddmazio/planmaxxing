import { useState } from 'react'
import { insert } from '../lib/db'
import { EXEC_WEEKS } from '../lib/cycle'
import type { Area, Goal, Habit, Step } from '../lib/types'
import { AreaIcon, Sheet } from './ui'
import { Icon } from './Icon'

type Kind = Goal['kind']
interface Draft { title: string; freq: string; from: number; to: number }

const KINDS: [Kind, string, string][] = [
  ['project', 'Projeto', 'Uma lista de passos (X, Y, Z) até chegar lá.'],
  ['habit', 'Hábito', 'Repetir algo todo dia ou toda semana.'],
  ['both', 'Projeto + hábito', 'Primeiro monta, depois mantém. Ex.: criar a planilha e depois acompanhar.'],
]

/** “mensurável”: tem número ou algo contável. */
const measurable = (s: string) => /\d|um |uma |dois|duas|três|tres|quatro|cinco|dez|vinte|cem|mil|primeir|todo|toda|cada/.test(s.toLowerCase())

/** Dias de um hábito a partir de “2x por semana”, “diário”… */
export function habitDays(freq: string): number[] | null {
  const f = freq.toLowerCase()
  if (/di[aá]ri|todo dia|todos os dias|por dia/.test(f)) return [0, 1, 2, 3, 4, 5, 6]
  if (/dias [uú]teis|seg.*sex/.test(f)) return [1, 2, 3, 4, 5]
  const m = f.match(/(\d)\s*x?\s*(por|na|\/)\s*semana/)
  if (m) return ({ 1: [1], 2: [2, 4], 3: [1, 3, 5], 4: [1, 2, 4, 5], 5: [1, 2, 3, 4, 5], 6: [1, 2, 3, 4, 5, 6], 7: [0, 1, 2, 3, 4, 5, 6] } as Record<number, number[]>)[Number(m[1])] ?? null
  if (/semanal|toda semana|1x/.test(f)) return [1]
  return null
}

/**
 * Nova meta em 3 passos, como no Figma: área (com inspiração), definição de pronto + tipo, passos por semana com a carga.
 * Usada no Plano do ciclo, na página da área, no onboarding e no ritual do trimestre.
 */
export function GoalWizard({ cycleId, areas, existing, position, areaId, inspiration, index, maxGoals = 3, current = 1, onDone, onCancel, inline }: {
  cycleId: string; areas: Area[]; existing: Step[]; position: number; areaId?: string
  inspiration?: string[]; index?: number; maxGoals?: number; current?: number
  onDone: (g: Goal) => void; onCancel: () => void; inline?: boolean
}) {
  const [step, setStep] = useState(0)
  const [area, setArea] = useState(areaId ?? '')
  const [title, setTitle] = useState('')
  const [def, setDef] = useState('')
  const [kind, setKind] = useState<Kind>('project')
  const [habit, setHabit] = useState({ title: '', freq: '' })
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [d, setD] = useState<Draft>({ title: '', freq: '', from: Math.max(1, current), to: Math.max(1, current) })
  const [busy, setBusy] = useState(false)
  const pick = areas.filter((a) => !a.archived)

  const load = Array.from({ length: EXEC_WEEKS }, (_, i) => existing.filter((s) => s.week === i + 1).length + drafts.filter((x) => i + 1 >= x.from && i + 1 <= x.to).length)
  const avg = load.reduce((a, b) => a + b, 0) / EXEC_WEEKS
  const heavy = load.map((v, i) => [v, i + 1] as const).filter(([v]) => v >= 3 && v > avg * 1.6).map(([, w]) => w)
  const max = Math.max(4, ...load)

  async function save() {
    setBusy(true)
    try {
      const g = await insert<Goal>('goals', { cycle_id: cycleId, area_id: area || null, title: title.trim(), done_definition: def.trim() ? `TER ${def.trim()}` : null, kind, position })
      let pos = existing.length
      for (const x of drafts) for (let w = x.from; w <= x.to; w++) await insert<Step>('steps', { goal_id: g.id, title: x.title, week: w, detail: x.freq || null, position: pos++ })
      if (kind !== 'project' && habit.title.trim()) await insert<Habit>('habits', { title: habit.title.trim(), area_id: area || null, days: habitDays(habit.freq) ?? [0, 1, 2, 3, 4, 5, 6], archived: false })
      onDone(g)
    } finally { setBusy(false) }
  }

  const body = (
    <div className="stack goal-wizard">
      <div className="row between">
        {step === 0 ? <button className="btn ghost small" onClick={onCancel}><Icon name="x" size={14} />Fechar</button> : <button className="btn ghost small" onClick={() => setStep(step - 1)}>← Voltar</button>}
        <span className="mono muted">Nova meta · {step + 1} de 3</span>
      </div>

      {step === 0 && (
        <>
          <span className="mono muted">Meta {(index ?? position) + 1} de até {maxGoals}</span>
          <h2 className="h1 serif-title">De qual área da sua vida é esta meta?</h2>
          <p className="muted" style={{ margin: 0 }}>Poucas metas por ciclo funcionam melhor. Menos é mais.</p>
          <div className="area-pick">
            {pick.map((a) => (
              <button key={a.id} className={'area-card' + (area === a.id ? ' on' : '')} aria-pressed={area === a.id} onClick={() => setArea(a.id)}
                style={area === a.id ? { background: `var(--${a.color}-bg)`, color: `var(--${a.color}-fg)` } : undefined}>
                <AreaIcon area={a} size={32} /><span className="medium">{a.name}</span>
              </button>
            ))}
          </div>
          <label className="field"><span>Nome da meta</span><input className="input" value={title} maxLength={200} placeholder="Ex.: Encontrar um estágio ou emprego" onChange={(e) => setTitle(e.target.value)} /></label>
          {inspiration && inspiration.length > 0 && (
            <div className="card soft stack" style={{ gap: 4 }}>
              <span className="mono muted">Inspiração do seu MasterPlan</span>
              {inspiration.slice(0, 6).map((t) => <button key={t} className="caption" style={{ textAlign: 'left' }} onClick={() => setTitle(t)}>• {t}</button>)}
            </div>
          )}
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!title.trim()} onClick={() => setStep(1)}>Continuar</button>
        </>
      )}

      {step === 1 && (
        <>
          <span className="mono muted">Definição de pronto</span>
          <h2 className="h1 serif-title">No fim do ciclo, eu preciso TER…</h2>
          <input className="input big-input" autoFocus value={def} maxLength={480} placeholder="assinado um contrato de trabalho em UX/UI" onChange={(e) => setDef(e.target.value)} aria-label="Definição de pronto" />
          <div className="row" style={{ gap: 8 }}>
            <span className={'pill caption' + (measurable(def) ? ' ok' : '')}>{measurable(def) ? '✓' : '○'} mensurável</span>
            <span className="pill caption ok">✓ tem prazo: o fim do ciclo</span>
          </div>
          <span className="medium" style={{ marginTop: 8 }}>Que tipo de meta é?</span>
          <div className="stack" style={{ gap: 8 }}>
            {KINDS.map(([k, l, h]) => <button key={k} className={'choice' + (kind === k ? ' on' : '')} onClick={() => setKind(k)}><span className="medium">{l}</span><span className="caption muted">{h}</span></button>)}
          </div>
          {kind !== 'project' && (
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow" placeholder="Hábito (ex.: publicar um vídeo)" value={habit.title} maxLength={120} onChange={(e) => setHabit({ ...habit, title: e.target.value })} aria-label="Hábito" />
              <input className="input" style={{ width: 160 }} placeholder="2x por semana" value={habit.freq} maxLength={40} onChange={(e) => setHabit({ ...habit, freq: e.target.value })} aria-label="Frequência do hábito" />
            </div>
          )}
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => setStep(2)}>Continuar</button>
        </>
      )}

      {step === 2 && (
        <>
          <span className="mono muted">Passos</span>
          <h2 className="h1 serif-title">O que fazer, e em qual semana?</h2>
          <div className="card flush list">
            {drafts.map((x, i) => (
              <div key={i} className="list-row">
                <div className="grow stack" style={{ gap: 0 }}><span>{x.title}</span>{x.freq && <span className="caption muted">{x.freq}</span>}</div>
                <span className="pill caption">S{x.from}{x.to > x.from ? `–S${x.to}` : ''}</span>
                <button className="faint" aria-label={`Tirar ${x.title}`} onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
              </div>
            ))}
            <form className="list-row step-form" onSubmit={(e) => { e.preventDefault(); if (!d.title.trim()) return; setDrafts([...drafts, { ...d, title: d.title.trim(), freq: d.freq.trim(), to: Math.max(d.from, d.to) }]); setD({ ...d, title: '', freq: '' }) }}>
              <Icon name="plus" size={16} className="faint" />
              <input className="input bare grow" placeholder="Adicionar passo" value={d.title} maxLength={200} onChange={(e) => setD({ ...d, title: e.target.value })} aria-label="Novo passo" />
              <input className="input bare" style={{ width: 110 }} placeholder="5 por dia" value={d.freq} maxLength={40} onChange={(e) => setD({ ...d, freq: e.target.value })} aria-label="Frequência (opcional)" />
              <select className="input" style={{ width: 72 }} value={d.from} onChange={(e) => { const v = Number(e.target.value); setD({ ...d, from: v, to: Math.max(v, d.to) }) }} aria-label="Da semana">
                {load.map((_, i) => <option key={i} value={i + 1}>S{i + 1}</option>)}</select>
              <span className="caption muted">a</span>
              <select className="input" style={{ width: 72 }} value={d.to} onChange={(e) => setD({ ...d, to: Number(e.target.value) })} aria-label="Até a semana">
                {load.map((_, i) => i + 1 >= d.from && <option key={i} value={i + 1}>S{i + 1}</option>)}</select>
              <button className="btn secondary small" disabled={!d.title.trim()}>Adicionar</button>
            </form>
          </div>
          <span className="mono muted">Carga por semana</span>
          <div className="load-chart" role="img" aria-label="Passos por semana">
            {load.map((v, i) => (
              <div key={i} className="lc-col">
                <span className={'lc-bar' + (heavy.includes(i + 1) ? ' heavy' : '')} style={{ height: `${(v / max) * 100}%` }} title={`S${i + 1}: ${v} passo${v === 1 ? '' : 's'}`} />
                <span className="mono faint">{i + 1}</span>
              </div>
            ))}
          </div>
          {heavy.length > 0 && <span className="caption">A semana {heavy.join(', ')} está pesada. Mover algum passo?</span>}
          <div className="row between card soft"><div className="stack" style={{ gap: 0 }}><span>Fazer com alguém?</span><span className="caption muted">Opcional · em breve, junto com o Grupo</span></div><span className="pill caption">em breve</span></div>
          <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={save}>{drafts.length ? 'Criar meta' : 'Criar meta sem passos'}</button>
        </>
      )}
    </div>
  )
  return inline ? body : <Sheet open onClose={onCancel} labelledBy="goal-wizard">{body}</Sheet>
}
