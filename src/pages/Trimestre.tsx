import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { insert, update } from '../lib/db'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, toIso, todayYmd, weekStart, ymd } from '../lib/dates'
import { EXEC_WEEKS, currentCycle, newCycleDates, score, weekOf } from '../lib/cycle'
import { inMonth, DEFAULT_RULE, ym } from '../lib/finance'
import { money, parseMoney } from '../lib/money'
import { useAuth } from '../lib/auth'
import type { Area, BudgetRule, CalEvent, Cycle, Goal, Habit, Income, Pot, Reflection, Step, Task } from '../lib/types'
import { AreaIcon, AreaTag, Empty } from '../components/ui'
import { Icon } from '../components/Icon'
import { ListInput, RailSteps } from '../components/ListInput'
import { GoalWizard, habitDays } from '../components/GoalWizard'
import { type ShellCtx } from '../components/Shell'

// ---------------------------------------------------------------- estado do ritual (guardado como JSON numa reflexão)
interface RT {
  step: number
  reset: { t: string; done: boolean }[]
  memo: string[]; good: string[]; notAgain: string[]; wins: Record<string, string[]>; regrets: string[]; rituals: string[]
  peoplePos: string[]; peopleNeg: string[]; resGood: string[]; resBad: string[]; resWhy: string; who: string[]
  words: string[]; wordsWhy: string
  notes: Record<string, { why: string; how: string }>
  improveText: string; improve: Record<string, string[]>
  focus: string[]; no: string[]; newCycleId?: string
  rewards: { t: string; when: string }[]
  dates: string[]; fun: { t: string; week: number }[]; weekend: string[]
  financeGoal: string; makePot: boolean
  courses: { t: string; size: string; pace: string }[]; sysIn: string; sysOut: string
  focusWeek: string[]; finished?: boolean
}
const RESET = ['Arrumar armários e separar doações', 'Limpar arquivos do computador', 'Zerar o Drive', 'Apagar tarefas antigas', 'Lavar mochilas e bolsas', 'Apagar fotos do celular', 'Resetar o financeiro e pagar pendências', 'Apagar apps que não uso', 'Arrumar a mesa de trabalho']
const empty = (): RT => ({
  step: 0, reset: RESET.map((t) => ({ t, done: false })), memo: [], good: [], notAgain: [], wins: {}, regrets: [], rituals: [],
  peoplePos: [], peopleNeg: [], resGood: [], resBad: [], resWhy: '', who: [], words: [], wordsWhy: '', notes: {}, improveText: '', improve: {},
  focus: [], no: [], rewards: [], dates: [], fun: [], weekend: [], financeGoal: '', makePot: true, courses: [], sysIn: 'metas, tarefas, agenda e visão geral', sysOut: '', focusWeek: [],
})

// as etapas, na ordem do Figma
const P1 = ['reset', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9']
const P2 = ['visao', 'notas', 'melhorias', 'prioridade', 'metas', 'nao']
const P3 = ['recompensas', 'datas', 'legais', 'financas', 'recursos', 'foco', 'resumo']
const ORDER = ['inicio', ...P1, 'pausa1', ...P2, 'pausa2', ...P3]
const P2_NAMES = ['Visão', 'Notas das áreas', 'Melhorias', 'Priorização', 'Metas', 'Dizer não']
const P3_NAMES = ['Recompensas', 'Datas', 'Coisas legais', 'Finanças', 'Recursos', 'Semana de foco', 'Resumo']
const QUESTIONS: Record<string, [string, string?]> = {
  q1: ['Quais foram os dias mais memoráveis do trimestre, e por quê?'],
  q2: ['O que deu certo e você quer fazer de novo?'],
  q3: ['O que você definitivamente não quer repetir?', 'Seja gentil consigo. Isto é para aprender, não para se culpar.'],
  q4: ['Quais foram as suas maiores conquistas?', 'Até 2 por área. Pode deixar em branco.'],
  q5: ['Do que você se arrependeu neste trimestre?'],
  q6: ['Quais rituais você quer ter no próximo ciclo?', 'Hábitos pequenos que dão o tom do trimestre.'],
  q7: ['Que pessoas marcaram o seu trimestre?'],
  q8: ['Que recursos você usou? O que deu certo e o que deu errado?'],
  q9: ['Como você quer se ver no final do ciclo?', 'Who is she?'],
}

// melhorias: separa o texto livre por área pelas palavras
const AREA_WORDS: Record<string, RegExp> = {
  trabalho: /trabalh|est[aá]gio|emprego|client|freela|portf[oó]lio|carreira|demanda|vaga|entrevista/,
  estudos: /estud|curso|\bux\b|aula|\bler\b|leitura|livro|faculdade|cmu|mestrado|aprender/,
  saude: /sa[uú]de|caminh|corr|academia|gin[aá]sio|treino|dormir|sono|comer|aliment|m[eé]dic|dentista|check-up|exerc/,
  relacoes: /fam[ií]lia|amig|namor|m[aã]e|\bpai\b|v[oó]\b|irm[aã]|falar mais|conversar|relac/,
  financas: /renda|dinheiro|poupar|guardar|economi|d[ií]vida|finan|investi|reserva/,
  eu: /terapia|journal|cabe[cç]a|medita|autoestima|hobby|criativ|autocuidado|mente|eu mesma/,
}
export function splitImprove(text: string, areas: Area[]) {
  const parts = text.split(/[,;.\n]|\se\s(?=[a-záéíóú]+r\b)/i).map((x) => x.trim().replace(/^(e|quero|também)\s+/i, '')).filter((x) => x.length > 2)
  const out: Record<string, string[]> = {}
  for (const p of parts) {
    const t = p.toLowerCase()
    const a = areas.find((x) => t.includes(x.name.toLowerCase())) ?? areas.find((x) => AREA_WORDS[x.color]?.test(t))
    const k = a?.id ?? 'sem-area'
    ;(out[k] ??= []).push(p.charAt(0).toUpperCase() + p.slice(1))
  }
  return out
}

/** Frequência escrita solta: “↻ 2x por semana”, “↻ diário”, “↻ 5 por dia”. */
export function parseFreq(s: string) {
  const t = s.toLowerCase()
  const m = t.match(/(\d+\s*x?\s*(por|na|\/)\s*(dia|semana|m[eê]s))|a cada \d+ dias|di[aá]ri[oa]|todo dia|todos os dias|toda semana|semanal|mensal|dias [uú]teis/)
  if (!m) return null
  const v = m[0].replace('todos os dias', 'diário').replace('todo dia', 'diário').replace(/di[aá]ri[oa]/, 'diário')
  return v
}

// ---------------------------------------------------------------- página
export function Trimestre() {
  const nav = useNavigate()
  const { toast } = useOutletContext<ShellCtx>()
  const { profile } = useAuth()
  const { rows: cycles, loading } = useRows<Cycle>('cycles', { order: { column: 'starts_on', ascending: false } })
  const { rows: refl } = useRows<Reflection>('reflections', { eq: { kind: 'reset' } })
  const { rows: areasAll } = useRows<Area>('areas', { order: { column: 'position' } })
  const areas = areasAll.filter((a) => !a.archived)
  const { rows: goals } = useRows<Goal>('goals')
  const { rows: steps } = useRows<Step>('steps')

  const row = refl.filter((r) => r.prompt === 'ritual-trimestre').find((r) => { try { return !JSON.parse(r.answers[0] ?? '{}').finished } catch { return false } })
  const saved = useMemo<RT | null>(() => { try { return row ? { ...empty(), ...JSON.parse(row.answers[0]) } : null } catch { return null } }, [row])
  const [st, setSt] = useState<RT | null>(null)
  const s = st ?? saved ?? empty()
  const set = (p: Partial<RT>) => setSt({ ...s, ...p })
  const rowId = useRef<string | null>(null)
  rowId.current = row?.id ?? rowId.current

  const newCycle = cycles.find((c) => c.id === s.newCycleId)
  const old = currentCycle(cycles.filter((c) => c.id !== s.newCycleId))
  const oldGoals = goals.filter((g) => g.cycle_id === old?.id)
  const oldSteps = steps.filter((x) => oldGoals.some((g) => g.id === x.goal_id))
  const newGoals = goals.filter((g) => g.cycle_id === newCycle?.id)
  const newSteps = steps.filter((x) => newGoals.some((g) => g.id === x.goal_id))

  // guarda sozinho, um pouco depois de cada mudança (dá para pausar e voltar)
  useEffect(() => {
    if (!st) return
    const t = setTimeout(async () => {
      const body = { answers: [JSON.stringify(st)], title: 'Ritual do trimestre' }
      if (rowId.current) await update<Reflection>('reflections', rowId.current, body)
      else { const r = await insert<Reflection>('reflections', { cycle_id: old?.id ?? null, kind: 'reset', week: null, prompt: 'ritual-trimestre', score: null, ...body }); rowId.current = r.id }
    }, 500)
    return () => clearTimeout(t)
  }, [st]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>
  const id = ORDER[s.step]
  const go = (i: number) => { set({ step: Math.max(0, Math.min(ORDER.length - 1, i)) }); window.scrollTo({ top: 0 }) }
  const next = () => go(s.step + 1)
  const part = P1.includes(id) ? 1 : P2.includes(id) || id === 'pausa1' ? 2 : P3.includes(id) || id === 'pausa2' ? 3 : 0

  async function ensureCycle() {
    if (newCycle) return newCycle
    const base = old ? addDays(fromYmd(old.ends_on), 1) : addDays(weekStart(new Date(), profile?.week_starts_on ?? 1), 7)
    const start = ymd(base < new Date() ? addDays(weekStart(new Date(), profile?.week_starts_on ?? 1), 7) : base)
    const d = fromYmd(start)
    const c = await insert<Cycle>('cycles', { name: `Q${Math.floor(d.getMonth() / 3) + 1} · ${d.getFullYear()}`, ...newCycleDates(start), status: 'planning', words: s.words.slice(0, 10), who_is_she: s.who.slice(0, 20) })
    setSt({ ...s, newCycleId: c.id })
    return c
  }

  async function finish() {
    const c = await ensureCycle()
    // semana de foco: o que tem frequência de hábito vira hábito; o resto vira tarefa
    for (const line of s.focusWeek) {
      const f = parseFreq(line); const days = f ? habitDays(f) : null
      const title = line.replace(/\(?↻?\s*(\d+\s*x?\s*(por|na|\/)\s*(dia|semana|m[eê]s)|a cada \d+ dias|di[aá]ri[oa]|todo dia|todos os dias|toda semana|semanal|mensal)\)?/i, '').replace(/[\s,·-]+$/, '').trim() || line
      if (days && !/por dia/.test(f!)) await insert<Habit>('habits', { title, area_id: null, days, archived: false })
      else await insert<Task>('tasks', { title, notes: f ? `Frequência: ${f}` : null, list_id: null, important: false, position: 0 })
    }
    const goal = parseMoney(s.financeGoal)
    if (goal && s.makePot) await insert<Pot>('pots', { name: `Meta do ${c.name}`, target_cents: goal, goal_id: null })
    await update<Cycle>('cycles', c.id, { status: 'active', words: s.words.slice(0, 10), who_is_she: s.who.slice(0, 20) })
    if (old && old.id !== c.id) await update<Cycle>('cycles', old.id, { status: 'closed' })
    const fin = { ...s, finished: true }
    if (rowId.current) await update<Reflection>('reflections', rowId.current, { answers: [JSON.stringify(fin)] })
    toast(`${c.name} começou. Bom ciclo!`)
    nav('/')
  }

  const prevWords = cycles.filter((c) => c.id !== s.newCycleId && c.words.length).slice(0, 4).reverse()
  const avgScore = (() => { const w = Array.from({ length: EXEC_WEEKS }, (_, i) => score(oldSteps.filter((x) => x.week === i + 1))).filter((v): v is number => v != null); return w.length ? Math.round(w.reduce((a, b) => a + b, 0) / w.length) : null })()
  const metGoals = oldGoals.filter((g) => { const x = oldSteps.filter((y) => y.goal_id === g.id); return x.length > 0 && x.every((y) => y.done_at) }).length
  const qn = P1.indexOf(id)

  return (
    <div className="page wide ritual-page">
      <aside className="ritual-rail">
        <span className="mono muted">Ritual do trimestre</span>
        <RailSteps title="1 · Olhar para trás" items={['Reset', 'Review']} active={part === 1 ? (id === 'reset' ? 0 : 1) : -1} done={s.step > ORDER.indexOf('pausa1') - 1 && part !== 1} onPick={(i) => go(ORDER.indexOf(i ? 'q1' : 'reset'))} />
        {part === 1 && qn > 0 && <span className="caption muted" style={{ marginTop: -10, paddingLeft: 10 }}>pergunta {qn} de 9</span>}
        <RailSteps title="2 · Decidir" items={P2_NAMES} active={P2.includes(id) ? P2.indexOf(id) : -1} done={s.step > ORDER.indexOf('nao')} onPick={(i) => go(ORDER.indexOf(P2[i]))} />
        <RailSteps title="3 · Organizar" items={P3_NAMES} active={P3.includes(id) ? P3.indexOf(id) : -1} done={false} onPick={(i) => go(ORDER.indexOf(P3[i]))} />
        <span className="caption faint">Dá para pausar a qualquer momento. O app guarda onde você parou.</span>
      </aside>

      <section className="stack ritual-main">
        <div className="row between">
          <span className="mono muted">{part ? `Parte ${part} de 3` : 'Início'}</span>
          <Link className="btn ghost small" to="/ciclo"><Icon name="x" size={14} />Pausar</Link>
        </div>

        {id === 'inicio' && (
          <div className="stack">
            {old && <span className="mono muted">{weekOf(old) >= 13 ? `13ª semana · ${fmt(addDays(fromYmd(old.ends_on), -6), 'd MMM')} a ${fmt(fromYmd(old.ends_on), 'd MMM')}` : old.name}</span>}
            <h1 className="serif-title" style={{ fontSize: 40, lineHeight: '44px' }}>{old ? `O ciclo ${old.name} ${weekOf(old) > EXEC_WEEKS ? 'terminou' : 'está acabando'}. Hora de olhar para trás e desenhar o próximo.` : 'Hora de desenhar o seu próximo trimestre.'}</h1>
            {old && (
              <div className="habit-stats">
                <div className="card stack" style={{ gap: 0 }}><span className="big">{EXEC_WEEKS}</span><span className="caption muted">semanas</span></div>
                <div className="card stack" style={{ gap: 0 }}><span className="big">{avgScore == null ? '–' : `${avgScore}%`}</span><span className="caption muted">placar médio</span></div>
                <div className="card stack" style={{ gap: 0 }}><span className="big">{metGoals} de {oldGoals.length}</span><span className="caption muted">metas</span></div>
              </div>
            )}
            <span className="mono muted">O ritual · 3 partes, no seu ritmo</span>
            <div className="card flush list">
              {[['Olhar para trás', 'Reset e 9 perguntas do review · ~30 min'], ['Decidir', 'Visão, notas, foco, metas e o que fica de fora · ~30 min'], ['Organizar', 'Recompensas, datas, finanças, recursos e o 1º mês · ~20 min']].map(([t, h], i) => (
                <div key={t} className="list-row"><span className="ritual-num">{i + 1}</span><div className="stack" style={{ gap: 0 }}><span className="medium">{t}</span><span className="caption muted">{h}</span></div></div>
              ))}
            </div>
            <p className="caption muted" style={{ margin: 0 }}>Dá para pausar a qualquer momento. O app guarda onde você parou.</p>
          </div>
        )}

        {id === 'reset' && (
          <div className="stack">
            <span className="mono muted">Parte 1 · Reset</span>
            <h1 className="serif-title">Antes de planejar, abra espaço.</h1>
            <p className="muted" style={{ margin: 0 }}>Marque o que já fez. Não precisa ser tudo hoje.</p>
            <div className="card flush list">
              {s.reset.map((r, i) => (
                <label key={i} className="list-row"><input type="checkbox" checked={r.done} onChange={() => set({ reset: s.reset.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) })} />
                  <span className={'grow' + (r.done ? ' done-text' : '')}>{r.t}</span></label>
              ))}
              <form className="list-row" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('r') as HTMLInputElement; if (f.value.trim()) set({ reset: [...s.reset, { t: f.value.trim(), done: false }] }); f.value = '' }}>
                <Icon name="plus" size={16} className="faint" /><input name="r" className="input bare grow" placeholder="Adicionar item ao seu reset" maxLength={120} aria-label="Novo item do reset" /></form>
            </div>
          </div>
        )}

        {qn > 0 && (
          <div className="stack">
            <span className="mono muted">Review · pergunta {qn}</span>
            <h1 className="serif-title">{QUESTIONS[id][0]}</h1>
            {QUESTIONS[id][1] && id !== 'q9' && <p className="muted" style={{ margin: 0 }}>{QUESTIONS[id][1]}</p>}
            {id === 'q1' && <ListInput label="Dias memoráveis" items={s.memo} onChange={(v) => set({ memo: v })} />}
            {id === 'q2' && <ListInput label="Deu certo" items={s.good} onChange={(v) => set({ good: v })} />}
            {id === 'q3' && <ListInput label="Não repetir" items={s.notAgain} onChange={(v) => set({ notAgain: v })} />}
            {id === 'q4' && areas.map((a) => (
              <div key={a.id} className="stack" style={{ gap: 6 }}>
                <span className="row" style={{ gap: 8 }}><AreaIcon area={a} size={24} /><span className="medium">{a.name}</span></span>
                <ListInput label={`Conquistas em ${a.name}`} items={s.wins[a.id] ?? []} max={2} placeholder="Escreva…" onChange={(v) => set({ wins: { ...s.wins, [a.id]: v } })} />
              </div>
            ))}
            {id === 'q5' && <ListInput label="Arrependimentos" items={s.regrets} onChange={(v) => set({ regrets: v })} />}
            {id === 'q6' && <>
              <ListInput label="Rituais" items={s.rituals} onChange={(v) => set({ rituals: v })} />
              <div className="card soft caption"><span className="mono muted">Dica</span><br />Na etapa de metas, rituais podem virar hábitos com frequência.</div>
            </>}
            {id === 'q7' && <People s={s} set={set} />}
            {id === 'q8' && <>
              <span className="mono muted">Deu certo</span><ListInput label="Recursos que deram certo" items={s.resGood} onChange={(v) => set({ resGood: v })} placeholder="Ex.: planner de papel" />
              <span className="mono muted">Deu errado</span><ListInput label="Recursos que deram errado" items={s.resBad} onChange={(v) => set({ resBad: v })} placeholder="Ex.: app de hábitos" />
              <label className="field"><span>Por quê? (opcional)</span><textarea className="input" rows={2} maxLength={1000} value={s.resWhy} placeholder="O papel funcionou porque eu via tudo de uma vez…" onChange={(e) => set({ resWhy: e.target.value })} /></label>
            </>}
            {id === 'q9' && <>
              <span className="serif" style={{ fontSize: 28 }}>Who is she?</span>
              <ListInput label="Who is she" items={s.who} onChange={(v) => set({ who: v })} placeholder="Ela…" max={20} />
            </>}
          </div>
        )}

        {id === 'pausa1' && (
          <Pause n={1} title="Parte 1 feita. Respira." text="Você olhou para trás com calma. A parte 2 decide o que vem: visão, áreas, metas e o que fica de fora."
            facts={[['Perguntas respondidas', `${[s.memo, s.good, s.notAgain, Object.values(s.wins).flat(), s.regrets, s.rituals, [...s.peoplePos, ...s.peopleNeg], [...s.resGood, ...s.resBad], s.who].filter((x) => x.length).length} de 9`], ['Who is she?', `${s.who.length} frase${s.who.length === 1 ? '' : 's'}`], ['Próxima parte', 'Decidir · ~30 min']]} />
        )}

        {id === 'visao' && (
          <div className="stack">
            <span className="mono muted">Visão</span>
            <h1 className="serif-title">Quais palavras vão definir este trimestre?</h1>
            <p className="muted" style={{ margin: 0 }}>Três palavras e o porquê.</p>
            <div className="wordchips">{s.words.map((w) => <button key={w} onClick={() => set({ words: s.words.filter((x) => x !== w) })} aria-label={`Tirar ${w}`}>{w} ✕</button>)}</div>
            {s.words.length < 3 && <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('w') as HTMLInputElement; const v = f.value.trim().toLowerCase(); if (v && !s.words.includes(v)) set({ words: [...s.words, v] }); f.value = '' }}>
              <input name="w" className="input" placeholder={['coragem', 'estudo', 'autoconfiança'][s.words.length]} maxLength={30} aria-label="Palavra do trimestre" /></form>}
            <label className="field"><span>Por quê?</span><input className="input" value={s.wordsWhy} maxLength={300} onChange={(e) => set({ wordsWhy: e.target.value })} /></label>
            {prevWords.length > 0 && <>
              <span className="mono muted">Seus trimestres anteriores</span>
              <div className="card flush list">{prevWords.map((c) => <div key={c.id} className="list-row"><span className="mono muted" style={{ width: 80 }}>{c.name}</span><span>{c.words.join(' · ')}</span></div>)}</div>
            </>}
          </div>
        )}

        {id === 'notas' && <Notas areas={areas} s={s} set={set} />}

        {id === 'melhorias' && (
          <div className="stack">
            <span className="mono muted">Melhorias</span>
            <h1 className="serif-title">O que você quer melhorar em cada área?</h1>
            <p className="muted" style={{ margin: 0 }}>Escreva do seu jeito, quanto quiser. O app separa por área para você revisar.</p>
            <label className="field"><span className="mono">Escreva livremente</span>
              <textarea className="input" rows={5} maxLength={3000} value={s.improveText} placeholder="Quero me organizar melhor no trabalho e conseguir um estágio, voltar a caminhar, falar mais com a minha família…"
                onChange={(e) => set({ improveText: e.target.value })} onBlur={() => s.improveText.trim() && set({ improve: splitImprove(s.improveText, areas) })} /></label>
            {s.improveText.trim() && <button className="btn secondary small" style={{ alignSelf: 'flex-start' }} onClick={() => set({ improve: splitImprove(s.improveText, areas) })}>Separar por área</button>}
            {Object.keys(s.improve).length > 0 && (
              <div className="card stack" style={{ gap: 10 }}>
                <div className="row between"><span className="mono muted">Entendi assim · revise</span><span className="caption muted">{Object.keys(s.improve).filter((k) => k !== 'sem-area').length} áreas</span></div>
                {[...areas.map((a) => a.id), 'sem-area'].filter((k) => s.improve[k]?.length).map((k) => {
                  const a = areas.find((x) => x.id === k)
                  return (
                    <div key={k} className="stack" style={{ gap: 4 }}>
                      {a ? <AreaTag area={a} /> : <span className="caption muted">Sem área (escolha uma)</span>}
                      {s.improve[k].map((t, i) => (
                        <div key={i} className="row" style={{ gap: 8 }}>
                          <input className="input bare grow" defaultValue={t} maxLength={200} aria-label="Melhoria" onBlur={(e) => { const n = { ...s.improve }; n[k] = [...n[k]]; n[k][i] = e.target.value; set({ improve: n }) }} />
                          <select className="input" style={{ width: 'auto' }} value={k} aria-label="Área" onChange={(e) => { const n = { ...s.improve }; n[k] = n[k].filter((_, j) => j !== i); (n[e.target.value] ??= []); n[e.target.value] = [...n[e.target.value], t]; set({ improve: n }) }}>
                            {areas.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}<option value="sem-area">Sem área</option>
                          </select>
                        </div>
                      ))}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {id === 'prioridade' && (
          <div className="stack">
            <span className="mono muted">Priorização</span>
            <h1 className="serif-title">Em quais áreas você vai focar neste ciclo?</h1>
            <p className="muted" style={{ margin: 0 }}>Escolha até 4. As outras ficam em manutenção, sem culpa.</p>
            <div className="area-pick">
              {areas.filter((a) => !a.is_fixed).map((a) => {
                const on = s.focus.includes(a.id)
                return <button key={a.id} className={'area-card' + (on ? ' on' : '')} aria-pressed={on} disabled={!on && s.focus.length >= 4}
                  style={on ? { background: `var(--${a.color}-bg)`, color: `var(--${a.color}-fg)` } : undefined}
                  onClick={() => set({ focus: on ? s.focus.filter((x) => x !== a.id) : [...s.focus, a.id] })}>
                  <div className="row between"><AreaIcon area={a} size={30} />{on && <Icon name="check" size={16} />}</div>
                  <span className="medium">{a.name}</span>
                  {s.improve[a.id]?.[0] && <span className="caption" style={{ opacity: 0.8 }}>{s.improve[a.id][0]}</span>}
                </button>
              })}
            </div>
            <span className="caption muted">{s.focus.length} de 4 escolhidas</span>
          </div>
        )}

        {id === 'metas' && <Metas s={s} areas={areas} newCycle={newCycle} goals={newGoals} steps={newSteps} ensureCycle={ensureCycle} />}

        {id === 'nao' && (
          <div className="stack">
            <span className="mono muted">Dizer não</span>
            <h1 className="serif-title">O que você não vai abraçar neste ciclo?</h1>
            <p className="muted" style={{ margin: 0 }}>Com as metas definidas, decida o que fica de fora para elas caberem. Não precisa ser um não completo: pode ser “agora não” ou “sim, mas menos”.</p>
            <ListInput label="O que fica de fora" items={s.no} onChange={(v) => set({ no: v })} placeholder="Ex.: novos projetos de voluntariado" />
          </div>
        )}

        {id === 'pausa2' && (
          <Pause n={2} title="Parte 2 feita. Falta pouco." text="Metas e o que fica de fora estão definidos. A parte 3 organiza o trimestre: recompensas, datas, finanças e o 1º mês."
            facts={[['Metas do ciclo', String(newGoals.length)], ['O que fica de fora', `${s.no.length} ite${s.no.length === 1 ? 'm' : 'ns'}`], ['Próxima parte', 'Organizar · ~20 min']]} />
        )}

        {id === 'recompensas' && (
          <div className="stack">
            <span className="mono muted">Recompensas</span>
            <h1 className="serif-title">Como você vai comemorar?</h1>
            <p className="muted" style={{ margin: 0 }}>Sem ser só comida. Ligue cada recompensa a um marco.</p>
            <div className="card flush list">
              {s.rewards.map((r, i) => (
                <div key={i} className="list-row" style={{ flexWrap: 'wrap', rowGap: 6 }}>
                  <span aria-hidden>★</span>
                  <div className="grow stack" style={{ gap: 0, minWidth: 180 }}><span>{r.t}</span><span className="caption muted">quando: {r.when}</span></div>
                  <button className="faint" aria-label={`Tirar ${r.t}`} onClick={() => set({ rewards: s.rewards.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button>
                </div>
              ))}
              <form className="list-row" style={{ flexWrap: 'wrap', rowGap: 8 }} onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const t = (f.elements.namedItem('t') as HTMLInputElement).value.trim(); const w = (f.elements.namedItem('w') as HTMLSelectElement).value; if (!t) return; set({ rewards: [...s.rewards, { t, when: w }] }); f.reset() }}>
                <Icon name="plus" size={16} className="faint" />
                <input name="t" className="input bare grow" style={{ minWidth: 180 }} placeholder="Ex.: comprar um perfume" maxLength={120} aria-label="Recompensa" />
                <select name="w" className="input" style={{ width: 'auto' }} aria-label="Quando">
                  <option>4 semanas seguidas ≥ 85%</option>
                  {newGoals.map((g) => <option key={g.id}>Meta “{g.title}” concluída</option>)}
                  <option>Fim do ciclo</option><option>Fim do 1º mês</option>
                </select>
                <button className="btn secondary small">Adicionar</button>
              </form>
            </div>
          </div>
        )}

        {id === 'datas' && <Datas s={s} set={set} cycle={newCycle} ensureCycle={ensureCycle} />}

        {id === 'legais' && (
          <div className="stack">
            <span className="mono muted">Plano do trimestre</span>
            <h1 className="serif-title">Que coisas legais você quer encaixar no ciclo?</h1>
            <p className="muted" style={{ margin: 0 }}>Eventos para pensar em ir, programas e comprinhas.</p>
            <div className="card flush list">
              {s.fun.map((f, i) => (
                <div key={i} className="list-row"><span className="grow">{f.t}</span>
                  <select className="input" style={{ width: 'auto' }} value={f.week} aria-label={`Semana de ${f.t}`} onChange={(e) => set({ fun: s.fun.map((x, j) => (j === i ? { ...x, week: Number(e.target.value) } : x)) })}>
                    <option value={0}>sem semana</option>{Array.from({ length: EXEC_WEEKS }, (_, w) => <option key={w} value={w + 1}>talvez S{w + 1}</option>)}</select>
                  <button className="faint" aria-label={`Tirar ${f.t}`} onClick={() => set({ fun: s.fun.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button></div>
              ))}
              <form className="list-row" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('t') as HTMLInputElement; if (f.value.trim()) set({ fun: [...s.fun, { t: f.value.trim(), week: 0 }] }); f.value = '' }}>
                <Icon name="plus" size={16} className="faint" /><input name="t" className="input bare grow" placeholder="Ex.: run club, aula de cerâmica" maxLength={120} aria-label="Coisa legal" /></form>
            </div>
            <span className="mono muted">Programa de fim de semana</span>
            <ListInput label="Programas de fim de semana" items={s.weekend} onChange={(v) => set({ weekend: v })} placeholder="Ex.: piquenique no parque" />
          </div>
        )}

        {id === 'financas' && <FinStep s={s} set={set} />}

        {id === 'recursos' && (
          <div className="stack">
            <span className="mono muted">Sistemas e recursos</span>
            <h1 className="serif-title">O que vai te apoiar neste ciclo?</h1>
            <span className="mono muted">Cursos e livros</span>
            <div className="card flush list">
              {s.courses.map((c, i) => (
                <div key={i} className="list-row"><div className="grow stack" style={{ gap: 0 }}><span>{c.t}</span><span className="caption muted">{[c.size, c.pace].filter(Boolean).join(' · ')}</span></div>
                  <button className="faint" aria-label={`Tirar ${c.t}`} onClick={() => set({ courses: s.courses.filter((_, j) => j !== i) })}><Icon name="x" size={14} /></button></div>
              ))}
              <form className="list-row" style={{ flexWrap: 'wrap', rowGap: 8 }} onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget; const g = (n: string) => (f.elements.namedItem(n) as HTMLInputElement).value.trim(); if (!g('t')) return; set({ courses: [...s.courses, { t: g('t'), size: g('s'), pace: g('p') }] }); f.reset() }}>
                <Icon name="plus" size={16} className="faint" />
                <input name="t" className="input bare grow" style={{ minWidth: 160 }} placeholder="Curso ou livro" maxLength={120} aria-label="Curso ou livro" />
                <input name="s" className="input bare" style={{ width: 100 }} placeholder="6 módulos" maxLength={40} aria-label="Tamanho" />
                <input name="p" className="input bare" style={{ width: 110 }} placeholder="2 por mês" maxLength={40} aria-label="Ritmo" />
                <button className="btn secondary small">Adicionar</button>
              </form>
            </div>
            <span className="mono muted">Sistemas</span>
            <label className="field"><span>Aqui no app</span><input className="input" value={s.sysIn} maxLength={200} onChange={(e) => set({ sysIn: e.target.value })} /></label>
            <label className="field"><span>Fora do app</span><input className="input" value={s.sysOut} maxLength={200} placeholder="Obsidian para anotações, Strava, Clue" onChange={(e) => set({ sysOut: e.target.value })} /></label>
          </div>
        )}

        {id === 'foco' && (
          <div className="stack">
            <span className="mono muted">Semana de foco</span>
            <h1 className="serif-title">Liste tudo o que precisa fazer em cada área no próximo mês.</h1>
            <p className="muted" style={{ margin: 0 }}>Escreva solto. A frequência vira dado sozinha (ex.: “caminhar 2x por semana”, “journal diário”).</p>
            <ListInput label="Semana de foco" items={s.focusWeek} onChange={(v) => set({ focusWeek: v })} max={40} placeholder="Ex.: conversar com a vó por chamada 1x por semana" />
            {s.focusWeek.some((x) => parseFreq(x)) && (
              <div className="card flush list">
                {s.focusWeek.map((x, i) => { const f = parseFreq(x); return f ? <div key={i} className="list-row"><span className="grow">{x}</span><span className="pill caption">↻ {f}</span></div> : null })}
              </div>
            )}
            <p className="caption muted" style={{ margin: 0 }}>Ao começar o ciclo, o que tem frequência por dia ou por semana vira hábito. O resto vira tarefa no Inbox.</p>
          </div>
        )}

        {id === 'resumo' && (
          <div className="stack">
            <span className="mono muted">{newCycle ? `Ciclo ${newCycle.name} · ${fmt(fromYmd(newCycle.starts_on), 'd MMM')} a ${fmt(addDays(fromYmd(newCycle.starts_on), EXEC_WEEKS * 7 - 1), 'd MMM')} · ${EXEC_WEEKS} semanas` : 'Resumo'}</span>
            {s.who.length > 0 && <p className="serif-title" style={{ fontSize: 30 }}>“{s.who.slice(0, 3).map((x) => x.replace(/[.;]+$/, '')).join('. ')}.”</p>}
            <div className="card flush list">
              {[
                ['Metas', `${newGoals.length}${newGoals.length ? ' · ' + [...new Set(newGoals.map((g) => areas.find((a) => a.id === g.area_id)?.name).filter(Boolean))].join(', ') : ''}`],
                ['Passos', `${newSteps.length} nas ${EXEC_WEEKS} semanas`],
                ['Hábitos novos', String(s.focusWeek.filter((x) => { const f = parseFreq(x); return f && habitDays(f) && !/por dia/.test(f) }).length)],
                ['Datas', `${s.dates.length} marcadas`],
                ['Recompensas', String(s.rewards.length)],
                ['O que fica de fora', String(s.no.length)],
                ['Ritual de domingo', 'planejar a semana no app'],
              ].map(([k, v]) => <div key={k} className="list-row"><span className="grow">{k}</span><span className="medium">{v}</span></div>)}
            </div>
            <button className="btn primary block" onClick={finish}>Começar o ciclo</button>
          </div>
        )}

        {!id.startsWith('pausa') && id !== 'resumo' && (
          <div className="row between" style={{ marginTop: 8 }}>
            {s.step > 0 ? <button className="btn secondary" onClick={() => go(s.step - 1)}>Voltar</button> : <span />}
            <button className="btn primary" onClick={async () => {
              if (id === 'notas') { /* notas já foram salvas nas áreas */ }
              if (id === 'melhorias') for (const a of areas) { const l = s.improve[a.id]; if (l?.length) await update<Area>('areas', a.id, { improve: l.join('. ').slice(0, 2000) }) }
              if (id === 'prioridade') for (const a of areas.filter((x) => !x.is_fixed)) if (a.focus !== s.focus.includes(a.id)) await update<Area>('areas', a.id, { focus: s.focus.includes(a.id) })
              if (id === 'visao' && newCycle) await update<Cycle>('cycles', newCycle.id, { words: s.words })
              if (id === 'q9' && newCycle) await update<Cycle>('cycles', newCycle.id, { who_is_she: s.who.slice(0, 20) })
              next()
            }}>{id === 'inicio' ? 'Começar' : 'Continuar'}</button>
          </div>
        )}
        {id.startsWith('pausa') && (
          <div className="row between" style={{ marginTop: 8 }}>
            <Link className="btn secondary" to="/ciclo">Continuar depois</Link>
            <button className="btn primary" onClick={next}>Continuar agora</button>
          </div>
        )}
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- partes
function Pause({ n, title, text, facts }: { n: number; title: string; text: string; facts: [string, string][] }) {
  return (
    <div className="stack" style={{ alignItems: 'flex-start' }}>
      <span className="mono muted">Parte {n} de 3 · concluída</span>
      <div className="win-badge" style={{ width: 96, height: 96 }}><span className="big" style={{ fontSize: 34 }}>{n}/3</span></div>
      <h1 className="serif-title">{title}</h1>
      <p className="muted" style={{ margin: 0 }}>{text}</p>
      <div className="card flush list" style={{ alignSelf: 'stretch' }}>{facts.map(([k, v]) => <div key={k} className="list-row"><span className="grow muted">{k}</span><span className="medium">{v}</span></div>)}</div>
      <span className="caption faint">O app guarda onde você parou. Dá para continuar amanhã.</span>
    </div>
  )
}

function People({ s, set }: { s: RT; set: (p: Partial<RT>) => void }) {
  const [show, setShow] = useState(false)
  const chips = (items: string[], key: 'peoplePos' | 'peopleNeg') => (
    <div className="chips">
      {items.map((p) => <span key={p} className="chip on">{p}<button aria-label={`Tirar ${p}`} onClick={() => set({ [key]: items.filter((x) => x !== p) })}><Icon name="x" size={12} /></button></span>)}
      <form onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget.elements.namedItem('p') as HTMLInputElement; const v = f.value.trim(); if (v && !items.includes(v)) set({ [key]: [...items, v] }); f.value = '' }}>
        <input name="p" className="input" style={{ width: 160, minHeight: 34 }} placeholder="+ nome" maxLength={40} aria-label="Pessoa" /></form>
    </div>
  )
  return (
    <>
      <span className="mono muted">De forma positiva</span>{chips(s.peoplePos, 'peoplePos')}
      <div className="row between"><span className="mono muted">De forma negativa</span><span className="caption muted">só você vê</span></div>
      {show ? chips(s.peopleNeg, 'peopleNeg') : <button className="card soft caption" style={{ textAlign: 'left' }} onClick={() => setShow(true)}>{s.peopleNeg.length ? `${s.peopleNeg.length} pessoa${s.peopleNeg.length === 1 ? '' : 's'} · toque para ver` : 'Toque para escrever'}</button>}
    </>
  )
}

function Notas({ areas, s, set }: { areas: Area[]; s: RT; set: (p: Partial<RT>) => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const fmtN = (v: number | null) => (v == null ? '–' : String(Number(v)).replace('.', ','))
  return (
    <div className="stack">
      <span className="mono muted">Áreas da vida</span>
      <h1 className="serif-title">De 0 a 10, como está cada área hoje? E onde você quer chegar?</h1>
      <div className="card flush list">
        {areas.map((a) => {
          const n = s.notes[a.id] ?? { why: '', how: '' }
          const setN = (p: Partial<typeof n>) => set({ notes: { ...s.notes, [a.id]: { ...n, ...p } } })
          return (
            <div key={a.id} className="stack notas-row">
              <button className="row" style={{ gap: 10, width: '100%' }} onClick={() => setOpen(open === a.id ? null : a.id)} aria-expanded={open === a.id}>
                <AreaIcon area={a} size={28} /><span className="grow medium" style={{ textAlign: 'left' }}>{a.name}</span>
                <span className="mono">{fmtN(a.score_now)} → {fmtN(a.score_goal)}</span><Icon name="chevron" size={14} />
              </button>
              <div className="grid2" style={{ gap: 12 }}>
                <label className="stack" style={{ gap: 2 }}><span className="caption muted">hoje · {fmtN(a.score_now)}</span>
                  <input type="range" min={0} max={10} step={0.5} defaultValue={a.score_now ?? 5} onPointerUp={(e) => update<Area>('areas', a.id, { score_now: Number(e.currentTarget.value) })} onKeyUp={(e) => update<Area>('areas', a.id, { score_now: Number(e.currentTarget.value) })} aria-label={`${a.name} hoje`} /></label>
                <label className="stack" style={{ gap: 2 }}><span className="caption muted">onde quero chegar · {fmtN(a.score_goal)}</span>
                  <input type="range" min={0} max={10} step={0.5} defaultValue={a.score_goal ?? 8} onPointerUp={(e) => update<Area>('areas', a.id, { score_goal: Number(e.currentTarget.value) })} onKeyUp={(e) => update<Area>('areas', a.id, { score_goal: Number(e.currentTarget.value) })} aria-label={`${a.name} onde quero chegar`} /></label>
              </div>
              {open === a.id && (
                <div className="grid2" style={{ gap: 12 }}>
                  <label className="field"><span>Por quê? (hoje)</span><textarea className="input" rows={2} maxLength={500} value={n.why} onChange={(e) => setN({ why: e.target.value })} /></label>
                  <label className="field"><span>Como? (quero)</span><textarea className="input" rows={2} maxLength={500} value={n.how} onChange={(e) => setN({ how: e.target.value })} /></label>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <span className="caption muted">Toque numa área para escrever o porquê da nota e como chegar lá.</span>
    </div>
  )
}

function Metas({ s, areas, newCycle, goals, steps, ensureCycle }: { s: RT; areas: Area[]; newCycle?: Cycle; goals: Goal[]; steps: Step[]; ensureCycle: () => Promise<Cycle> }) {
  const [open, setOpen] = useState(false)
  const [cid, setCid] = useState<string | null>(null)
  const KIND = { project: 'Projeto', habit: 'Hábito', both: 'Projeto + hábito' }
  const insp = [...s.focus, ...Object.keys(s.improve)].flatMap((k) => s.improve[k] ?? []).filter((v, i, a) => a.indexOf(v) === i)
  return (
    <div className="stack">
      <span className="mono muted">Metas</span>
      <h1 className="serif-title">No fim do {newCycle?.name ?? 'ciclo'}, eu preciso TER…</h1>
      <p className="muted" style={{ margin: 0 }}>Cada meta tem um “pronto” claro e um tipo: hábito, projeto ou os dois.</p>
      {goals.length ? (
        <div className="card flush list">
          {goals.map((g) => (
            <div key={g.id} className="list-row">
              <div className="grow stack" style={{ gap: 2 }}><span className="mono muted">{KIND[g.kind]}</span><span className="medium">{g.title}</span>{g.done_definition && <span className="caption muted">{g.done_definition}</span>}</div>
              <AreaTag area={areas.find((a) => a.id === g.area_id)} />
            </div>
          ))}
        </div>
      ) : <Empty>Nenhuma meta ainda.</Empty>}
      <button className="btn secondary" disabled={goals.length >= 5} onClick={async () => { const c = await ensureCycle(); setCid(c.id); setOpen(true) }}><Icon name="plus" size={16} />Criar meta (abre o passo a passo)</button>
      <span className="caption muted">Recomendado: até 3 metas por ciclo.</span>
      {open && cid && <GoalWizard cycleId={cid} areas={areas} existing={steps} position={goals.length} index={goals.length} inspiration={insp} areaId={s.focus[goals.length]}
        onDone={() => setOpen(false)} onCancel={() => setOpen(false)} />}
    </div>
  )
}

function Datas({ s, set, cycle, ensureCycle }: { s: RT; set: (p: Partial<RT>) => void; cycle?: Cycle; ensureCycle: () => Promise<Cycle> }) {
  const from = cycle?.starts_on ?? todayYmd()
  const to = cycle?.ends_on ?? ymd(addDays(new Date(), 91))
  const { rows: events } = useRows<CalEvent>('events', { gte: { starts_at: toIso(from) }, lt: { starts_at: toIso(to) }, order: { column: 'starts_at' } })
  const kindOf = (e: CalEvent) => /anivers/i.test(e.title) ? 'aniversário' : /feriado/i.test(e.title) ? 'feriado' : /viagem|f[eé]rias|pausa/i.test(e.title) ? 'viagem' : e.all_day ? 'evento' : 'compromisso'
  const big = events.filter((e) => e.all_day || new Date(e.ends_at).getTime() - new Date(e.starts_at).getTime() >= 3 * 3600e3 || /anivers|feriado|viagem|entrevista|apresenta/i.test(e.title))
  const fromG = big.filter((e) => e.external_id?.startsWith('gcal:')).length
  const span = (e: CalEvent) => { const a = new Date(e.starts_at), b = new Date(new Date(e.ends_at).getTime() - (e.all_day ? 1 : 0)); return a.toDateString() === b.toDateString() ? fmt(a, 'd') : `${fmt(a, 'd')}–${fmt(b, 'd')}` }
  return (
    <div className="stack">
      <span className="mono muted">Plano do trimestre</span>
      <h1 className="serif-title">Eventos, feriados, viagens e aniversários</h1>
      <p className="muted" style={{ margin: 0 }}>{fromG ? `${fromG} datas vieram do Google Calendar. ` : ''}Confira e marque o que importa.</p>
      {big.length ? (
        <div className="card flush list">
          {big.map((e) => {
            const on = s.dates.includes(e.id)
            return (
              <label key={e.id} className="list-row">
                <div className="date-chip"><span className="mono">{fmt(new Date(e.starts_at), 'MMM').toUpperCase()}</span><span className="medium">{span(e)}</span></div>
                <div className="grow stack" style={{ gap: 0 }}><span>{e.title}</span><span className="caption muted">{kindOf(e)}</span></div>
                <input type="checkbox" checked={on} onChange={() => set({ dates: on ? s.dates.filter((x) => x !== e.id) : [...s.dates, e.id] })} aria-label={`Importa: ${e.title}`} />
              </label>
            )
          })}
        </div>
      ) : <Empty>Nenhuma data grande no período do ciclo ainda.</Empty>}
      <form className="card row" style={{ flexWrap: 'wrap', gap: 8 }} onSubmit={async (e) => { e.preventDefault(); const f = e.currentTarget; const t = (f.elements.namedItem('t') as HTMLInputElement).value.trim(); const d = (f.elements.namedItem('d') as HTMLInputElement).value; if (!t || !d) return
        await ensureCycle(); const ev = await insert<CalEvent>('events', { title: t, starts_at: toIso(d), ends_at: toIso(ymd(addDays(fromYmd(d), 1))), all_day: true, kind: 'appointment', area_id: null, location: null, notes: null, reminder_minutes: null }); set({ dates: [...s.dates, ev.id] }); f.reset() }}>
        <Icon name="plus" size={16} className="faint" />
        <input name="t" className="input grow" style={{ minWidth: 160 }} placeholder="Adicionar data (ex.: aniversário do pai)" maxLength={120} aria-label="Nova data" />
        <input name="d" type="date" className="input" style={{ width: 160 }} aria-label="Dia" defaultValue={from} />
        <button className="btn secondary small">Adicionar</button>
      </form>
    </div>
  )
}

function FinStep({ s, set }: { s: RT; set: (p: Partial<RT>) => void }) {
  const { profile } = useAuth()
  const cur = profile?.currency_main ?? 'EUR'
  const { rows: incomes } = useRows<Income>('incomes')
  const { rows: rules } = useRows<BudgetRule>('budget_rules')
  const rule = rules[0] ?? DEFAULT_RULE
  const monthly = inMonth(incomes, 'received_on', ym(new Date())).reduce((a, r) => a + r.amount_cents, 0)
  const suggested = Math.round((monthly * rule.savings_pct) / 100) * 3
  return (
    <div className="stack">
      <span className="mono muted">Plano do trimestre</span>
      <h1 className="serif-title">Sua meta financeira do ciclo</h1>
      <p className="muted" style={{ margin: 0 }}>Puxamos os números de Finanças. Ajuste se quiser.</p>
      <div className="card flush list">
        <div className="list-row"><span className="grow">Renda por mês</span><span className="medium">{money(monthly, cur)}</span></div>
        <div className="list-row"><span className="grow">Economias pela sua regra ({rule.savings_pct}%)</span><span className="medium">{money(Math.round((monthly * rule.savings_pct) / 100), cur)} / mês</span></div>
        <label className="list-row"><span className="grow">Guardar no ciclo (3 meses)</span>
          <input className="input" style={{ width: 140 }} inputMode="decimal" value={s.financeGoal} placeholder={suggested ? (suggested / 100).toFixed(2).replace('.', ',') : '0,00'} onChange={(e) => set({ financeGoal: e.target.value })} /></label>
        <label className="list-row"><span className="grow">Criar um pote com esta meta</span><input type="checkbox" checked={s.makePot} onChange={() => set({ makePot: !s.makePot })} /></label>
      </div>
      {!s.financeGoal && suggested > 0 && <button className="caption medium" style={{ alignSelf: 'flex-start' }} onClick={() => set({ financeGoal: (suggested / 100).toFixed(2).replace('.', ',') })}>Usar a sugestão: {money(suggested, cur)}</button>}
      <div className="card soft row" style={{ gap: 8 }}><Icon name="lock" size={16} /><span className="caption"><b>Privado.</b> Valores financeiros nunca aparecem para o grupo, nem no modo “Tudo”.</span></div>
    </div>
  )
}
