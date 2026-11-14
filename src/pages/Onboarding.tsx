import { useEffect, useState } from 'react'
import { DEMO, callFunction, insert, saveRule, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { CURRENCIES, CURRENCY_INFO, money, parseMoney } from '../lib/money'
import { addDays, fmt, fromYmd, weekStart, ymd } from '../lib/dates'
import { newCycleDates, EXEC_WEEKS } from '../lib/cycle'
import { useCalendars } from '../lib/calendars'
import type { Area, AreaColor, Cycle, Expense, Income, Integration, Reflection, Step } from '../lib/types'
import { AreaIcon, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { ListInput } from '../components/ListInput'
import { GoalWizard } from '../components/GoalWizard'

const zones = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') } catch { return ['Europe/Lisbon', 'America/Sao_Paulo'] } })()
const STEPS = ['Boas-vindas', 'Sobre você', 'Google Calendar', 'Áreas da vida', 'Finanças', 'Novo ciclo', 'Primeira meta']
const FIN = ['renda', 'regra', 'contas fixas']
const KEY = 'onboarding-step'
const quarter = (d: string) => { const x = fromYmd(d); return `Q${Math.floor(x.getMonth() / 3) + 1} · ${x.getFullYear()}` }
const PRESETS = [{ n: 50, w: 30, t: '50 / 30 / 20', h: 'Necessidades, desejos e economias. O ponto de partida mais comum.' }, { n: 70, w: 20, t: '70 / 20 / 10', h: 'Quando as contas pesam mais, como aluguel alto.' }]
const COLORS: AreaColor[] = ['trabalho', 'estudos', 'saude', 'relacoes', 'eu', 'neutro']

interface Src { item: string; val: string; cur: string; rate: string; variable: boolean }
interface Bill { item: string; val: string; cat: Expense['category'] }

function load(): [number, number] { try { const v = JSON.parse(localStorage.getItem(KEY) ?? '[0,0]'); return [Number(v[0]) || 0, Number(v[1]) || 0] } catch { return [0, 0] } }

export function Onboarding() {
  const { profile, saveProfile } = useAuth()
  const [[step, sub], setPos] = useState<[number, number]>(load)
  const go = (s: number, f = 0) => { setPos([s, f]); try { localStorage.setItem(KEY, JSON.stringify([s, f])) } catch { /* */ } window.scrollTo({ top: 0 }) }
  const back = () => (step === 4 && sub > 0 ? go(4, sub - 1) : step === 5 ? go(4, 2) : go(Math.max(0, step - 1)))
  const finish = async () => { try { localStorage.removeItem(KEY) } catch { /* */ } await saveProfile({ onboarded: true }) }

  // dados de cada etapa
  const [name, setName] = useState(profile?.display_name ?? '')
  const [gender, setGender] = useState(profile?.gender ?? '')
  const [birth, setBirth] = useState(profile?.birth_date ?? '')
  const [tz, setTz] = useState(profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [cur, setCur] = useState(profile?.currency_main ?? 'EUR')
  const { rows: areas } = useRows<Area>('areas', { order: { column: 'position' } })
  const [newArea, setNewArea] = useState('')
  const [srcs, setSrcs] = useState<Src[]>([{ item: 'Salário ou bolsa', val: '', cur: profile?.currency_main ?? 'EUR', rate: '', variable: false }])
  const [rule, setRule] = useState({ n: 50, w: 30, custom: false })
  const [bills, setBills] = useState<Bill[]>([
    { item: 'Renda de casa', val: '', cat: 'needs' }, { item: 'Transporte', val: '', cat: 'needs' }, { item: 'Telemóvel', val: '', cat: 'needs' },
    { item: 'Streaming', val: '', cat: 'wants' }, { item: 'Ginásio', val: '', cat: 'wants' },
  ])
  const { rows: cycles } = useRows<Cycle>('cycles')
  const existingCycle = cycles.find((c) => c.status !== 'closed')
  const [start, setStart] = useState(ymd(addDays(weekStart(new Date(), 1), 7)))
  const [words, setWords] = useState<string[]>([])
  const [why, setWhy] = useState('')
  const [who, setWho] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const { rows: steps } = useRows<Step>('steps')

  const fx = (s: Src) => (s.cur === cur ? 1 : Number(s.rate.replace(',', '.')) || 0)
  const srcCents = (s: Src) => Math.round((parseMoney(s.val) ?? 0) * fx(s))
  const income = srcs.reduce((a, s) => a + srcCents(s), 0)
  const fixed = bills.reduce((a, b) => a + (parseMoney(b.val) ?? 0), 0)
  const $ = (c: number) => money(c, cur)
  const month1 = `${ymd(new Date()).slice(0, 7)}-01`
  const dates = newCycleDates(start)

  async function saveFinance() {
    setBusy(true)
    try {
      for (const s of srcs) {
        const c = parseMoney(s.val); if (!c || !s.item.trim() || !fx(s)) continue
        const extra = s.cur !== cur ? { original_amount_cents: c, original_currency: s.cur, fx_rate: fx(s) } : {}
        if (s.cur !== cur) try { localStorage.setItem(`fx:${s.cur}:${cur}`, s.rate) } catch { /* */ }
        await insert<Income>('incomes', { item: s.item.trim(), amount_cents: Math.round(c * fx(s)), received_on: month1, recurring: true, ...extra })
      }
      for (const b of bills) { const c = parseMoney(b.val); if (c && b.item.trim()) await insert<Expense>('expenses', { item: b.item.trim(), amount_cents: c, category: b.cat, spent_on: month1, recurring: true }) }
      go(5)
    } finally { setBusy(false) }
  }

  async function createCycle() {
    if (existingCycle) { go(6); return }
    setBusy(true)
    try {
      const c = await insert<Cycle>('cycles', { name: quarter(start), ...dates, status: 'active', words: words.slice(0, 10), who_is_she: who.slice(0, 20) })
      if (why.trim()) await insert<Reflection>('reflections', { cycle_id: c.id, kind: 'journal', week: null, prompt: 'Por que estas palavras', answers: [why.trim()], title: null, score: null })
      go(6)
    } finally { setBusy(false) }
  }

  const stepLabel = (i: number) => (i === 4 && step === 4 ? `${sub + 1} de 3 · ${FIN[sub]}` : null)

  return (
    <div className="onb">
      <aside className="onb-rail">
        <span className="mono muted">Começar</span>
        <div className="stack" style={{ gap: 4 }}>
          <span className="mono">Primeiros passos</span><span className="caption muted">{step + 1} de 7</span>
        </div>
        <div className="stack" style={{ gap: 2 }}>
          {STEPS.map((l, i) => (
            <div key={l} className={'rail-item' + (i === step ? ' on' : i < step ? ' done' : '')}>{l}{stepLabel(i) && <span className="caption muted" style={{ display: 'block', fontWeight: 400 }}>{stepLabel(i)}</span>}</div>
          ))}
        </div>
        <span className="caption faint">Leva uns 5 minutos</span>
      </aside>

      <main className="onb-main stack">
        <div className="onb-progress">{STEPS.map((_, i) => <span key={i} className={i <= step ? 'on' : ''} />)}</div>
        {step > 0 && step < 6 && (
          <div className="row between">
            <button className="btn ghost small" onClick={back}>← Voltar</button>
            <span className="mono muted">{step === 4 ? `Finanças · ${sub + 1}/3` : step === 2 ? 'Pode pular' : `${step + 1} de 7`}</span>
          </div>
        )}

        {step === 0 && (
          <div className="stack onb-hero">
            <span className="brand-mark big-mark">db</span>
            <h1 className="serif onb-title">Um ano cabe em 12 semanas.</h1>
            <p className="muted" style={{ margin: 0, fontSize: 17 }}>Planeje por ciclos, acompanhe a execução da semana e cresça junto com quem você ama.</p>
            <button className="btn primary" style={{ alignSelf: 'flex-start' }} onClick={() => go(1)}>Começar</button>
            <span className="caption faint">Ao continuar, você aceita os Termos e a <a className="link" href="/privacidade">Política de Privacidade</a>.</span>
          </div>
        )}

        {step === 1 && (
          <>
            <h1 className="serif onb-title">Prazer! Conta um pouco sobre você.</h1>
            <label className="field"><span>Nome</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="given-name" /></label>
            <div className="grid2" style={{ gap: 12 }}>
              <label className="field"><span>Gênero (opcional)</span>
                <select className="input" value={gender} onChange={(e) => setGender(e.target.value)}>
                  <option value="">Prefiro não dizer</option><option value="mulher">Mulher</option><option value="homem">Homem</option><option value="nao-binario">Não binário</option><option value="outro">Outro</option>
                </select></label>
              <label className="field"><span>Aniversário</span><input className="input" type="date" value={birth} onChange={(e) => setBirth(e.target.value)} /></label>
              <label className="field"><span>Fuso horário</span>
                <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z}>{z}</option>)}</select></label>
              <label className="field"><span>Moeda principal</span>
                <select className="input" value={cur} onChange={(e) => setCur(e.target.value)}>{CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
            </div>
            <p className="caption muted" style={{ margin: 0 }}>O aniversário avisa o grupo. Fuso e moeda seguem o país onde você vive. Se você recebe em outra moeda, dá para somar depois.</p>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!name.trim()} onClick={async () => {
              await saveProfile({ display_name: name.trim(), timezone: tz, currency_main: cur, gender: gender || null, birth_date: birth || null })
              setSrcs(srcs.map((s) => ({ ...s, cur: s.val ? s.cur : cur }))); go(2)
            }}>Continuar</button>
          </>
        )}

        {step === 2 && <GoogleStep areas={areas} onNext={() => go(3)} />}

        {step === 3 && (
          <>
            <h1 className="serif onb-title">O que você quer cuidar neste ciclo?</h1>
            <p className="muted" style={{ margin: 0 }}>Escolha, renomeie ou crie as suas áreas. Dá para mudar a qualquer momento.</p>
            <div className="area-pick">
              {areas.filter((a) => !a.archived).map((a) => {
                const on = a.focus || a.is_fixed
                return (
                  <div key={a.id} className={'area-card' + (on ? ' on' : '')} style={on ? { background: `var(--${a.color}-bg)`, color: `var(--${a.color}-fg)` } : undefined}>
                    <div className="row between"><AreaIcon area={a} size={30} />
                      {a.is_fixed ? <span className="caption row" style={{ gap: 4 }}><Icon name="lock" size={14} />Sempre ativa</span>
                        : <button aria-pressed={on} aria-label={`${a.name} em foco`} onClick={() => update<Area>('areas', a.id, { focus: !a.focus })} className={'mini-check' + (on ? ' on' : '')}>{on && <Icon name="check" size={14} />}</button>}
                    </div>
                    <input className="input bare medium" defaultValue={a.name} maxLength={40} disabled={a.is_fixed} aria-label={`Nome da área ${a.name}`}
                      onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== a.name) update<Area>('areas', a.id, { name: v }) }} />
                  </div>
                )
              })}
            </div>
            <form className="row" style={{ gap: 8 }} onSubmit={async (e) => { e.preventDefault(); const v = newArea.trim(); if (!v) return; setNewArea('')
              await insert<Area>('areas', { name: v, color: COLORS[areas.length % COLORS.length], icon: 'dot', position: areas.length + 1, focus: true, is_fixed: false, archived: false }) }}>
              <input className="input grow" placeholder="Criar outra área (ex.: Casa, Criatividade)" value={newArea} maxLength={40} onChange={(e) => setNewArea(e.target.value)} aria-label="Nova área" />
              <button className="btn secondary" disabled={!newArea.trim()}>Criar</button>
            </form>
            <p className="caption muted" style={{ margin: 0 }}>Depois: suas finanças, o ciclo e o “Who is she?”.</p>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => go(4, 0)}>Continuar</button>
          </>
        )}

        {step === 4 && sub === 0 && (
          <>
            <h1 className="serif onb-title">Quanto entra por mês, mais ou menos?</h1>
            <div className="card flush list">
              {srcs.map((s, i) => {
                const set = (p: Partial<Src>) => setSrcs(srcs.map((x, j) => (j === i ? { ...x, ...p } : x)))
                const foreign = s.cur !== cur
                return (
                  <div key={i} className="list-row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
                    <div className="grow stack" style={{ gap: 2, minWidth: 180 }}>
                      <input className="input bare medium" value={s.item} maxLength={80} onChange={(e) => set({ item: e.target.value })} aria-label="Fonte de renda" placeholder="Fonte de renda" />
                      <span className="caption muted row" style={{ gap: 6 }}>
                        <button className="caption muted" onClick={() => set({ variable: !s.variable })}>{s.variable ? 'variável' : 'fixo'}</button>·
                        <select className="input bare caption" style={{ width: 'auto', padding: 0, minHeight: 0 }} value={s.cur} onChange={(e) => set({ cur: e.target.value })} aria-label="Moeda">{CURRENCIES.map(([c]) => <option key={c} value={c}>recebe em {CURRENCY_INFO[c]?.name.split(' ')[0].toLowerCase()}</option>)}</select>
                      </span>
                    </div>
                    <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="0,00" value={s.val} onChange={(e) => set({ val: e.target.value })} aria-label={`Valor de ${s.item}`} />
                    {foreign && <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder={`1 ${s.cur} = ? ${cur}`} value={s.rate} onChange={(e) => set({ rate: e.target.value })} aria-label="Câmbio" />}
                    {foreign && parseMoney(s.val) && fx(s) ? <span className="caption muted" style={{ width: '100%' }}>{money(parseMoney(s.val)!, s.cur)} ≈ {$(srcCents(s))}</span> : null}
                    {srcs.length > 1 && <button className="faint" aria-label="Tirar fonte" onClick={() => setSrcs(srcs.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>}
                  </div>
                )
              })}
              <button className="list-row muted" onClick={() => setSrcs([...srcs, { item: '', val: '', cur, rate: '', variable: true }])}><Icon name="plus" size={16} />Outra fonte de renda</button>
              <div className="list-row"><span className="grow medium">Total por mês</span><span className="big" style={{ fontSize: 24 }}>{$(income)}</span></div>
            </div>
            <p className="caption muted" style={{ margin: 0 }}>Não precisa ser exato. Dá para ajustar quando quiser, e cada lançamento de renda atualiza o total.</p>
            <div className="row between"><button className="btn ghost" onClick={() => go(5)}>Pular finanças</button><button className="btn primary" onClick={() => go(4, 1)}>Continuar</button></div>
          </>
        )}

        {step === 4 && sub === 1 && (
          <>
            <h1 className="serif onb-title">Como você quer dividir?</h1>
            <div className="stack" style={{ gap: 8 }}>
              {PRESETS.map((p) => <button key={p.t} className={'choice' + (!rule.custom && rule.n === p.n ? ' on' : '')} onClick={() => setRule({ n: p.n, w: p.w, custom: false })}><span className="medium">{p.t}</span><span className="caption muted">{p.h}</span></button>)}
              <button className={'choice' + (rule.custom ? ' on' : '')} onClick={() => setRule({ ...rule, custom: true })}><span className="medium">Personalizada</span><span className="caption muted">Você define os três números.</span></button>
            </div>
            {rule.custom && ([['Necessidades', 'n'], ['Desejos', 'w']] as const).map(([l, k]) => (
              <label key={k} className="stack" style={{ gap: 4 }}><span className="row between"><span>{l}</span><span className="medium">{rule[k]}%</span></span>
                <input type="range" min={0} max={100} step={5} value={rule[k]} onChange={(e) => setRule({ ...rule, [k]: Number(e.target.value) })} /></label>
            ))}
            <div className="card flush list">
              {([['Necessidades', rule.n], ['Desejos', rule.w], ['Economias', 100 - rule.n - rule.w]] as const).map(([l, p]) => (
                <div key={l} className="list-row"><span className="grow">{l} · {p}%</span><span className="medium">{income ? $(Math.round((income * p) / 100)) : ''}</span></div>
              ))}
            </div>
            <p className="caption muted" style={{ margin: 0 }}>A regra vira o seu orçamento do mês. O app avisa quando uma parte chega perto do limite.</p>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={rule.n + rule.w > 100} onClick={async () => { await saveRule({ needs_pct: rule.n, wants_pct: rule.w, savings_pct: 100 - rule.n - rule.w }); go(4, 2) }}>Continuar</button>
          </>
        )}

        {step === 4 && sub === 2 && (
          <>
            <h1 className="serif onb-title">Quais contas são fixas todo mês?</h1>
            <div className="card flush list">
              {bills.map((b, i) => {
                const set = (p: Partial<Bill>) => setBills(bills.map((x, j) => (j === i ? { ...x, ...p } : x)))
                return (
                  <div key={i} className="list-row">
                    <input className="input bare grow" value={b.item} maxLength={80} onChange={(e) => set({ item: e.target.value })} aria-label="Conta fixa" placeholder="Conta" />
                    <input className="input" style={{ width: 120 }} inputMode="decimal" placeholder="0,00" value={b.val} onChange={(e) => set({ val: e.target.value })} aria-label={`Valor de ${b.item}`} />
                    <button className="faint" aria-label="Tirar conta" onClick={() => setBills(bills.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
                  </div>
                )
              })}
              <button className="list-row muted" onClick={() => setBills([...bills, { item: '', val: '', cat: 'needs' }])}><Icon name="plus" size={16} />Outra conta</button>
              <div className="list-row"><div className="grow stack" style={{ gap: 0 }}><span className="medium">Livre depois das contas</span><span className="caption muted">{$(income)} − {$(fixed)} de fixos</span></div><span className="big" style={{ fontSize: 24 }}>{$(income - fixed)}</span></div>
            </div>
            <p className="caption muted" style={{ margin: 0 }}>Elas entram sozinhas em Lançamentos todo mês. Você só confere.</p>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={saveFinance}>Continuar</button>
          </>
        )}

        {step === 5 && (
          existingCycle ? (
            <>
              <h1 className="serif onb-title">Seu ciclo já existe: {existingCycle.name}.</h1>
              <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => go(6)}>Continuar</button>
            </>
          ) : (
            <>
              <span className="mono muted">Novo ciclo · {quarter(start)}</span>
              <h1 className="serif onb-title">Como vai ser este ciclo?</h1>
              <div className="grid2" style={{ gap: 12 }}>
                <label className="field"><span>Começa em</span><input className="input" type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} /></label>
                <div className="field"><span>Duração</span><div className="input" style={{ display: 'flex', alignItems: 'center' }}>{EXEC_WEEKS} semanas</div></div>
              </div>
              <span className="caption muted">+ 13ª semana de review: {fmt(addDays(fromYmd(dates.ends_on), -6), 'd MMM')} a {fmt(fromYmd(dates.ends_on), 'd MMM')}</span>
              <span className="mono muted" style={{ marginTop: 8 }}>3 palavras para este ciclo</span>
              <div className="wordchips">{words.map((w) => <button key={w} onClick={() => setWords(words.filter((x) => x !== w))} aria-label={`Tirar ${w}`}>{w} ✕</button>)}</div>
              {words.length < 3 && <form onSubmit={(e) => { e.preventDefault(); const f = (e.currentTarget.elements.namedItem('w') as HTMLInputElement); const v = f.value.trim(); if (v && !words.includes(v)) setWords([...words, v]); f.value = '' }}>
                <input name="w" className="input" placeholder={['foco', 'coragem', 'leveza'][words.length]} maxLength={30} aria-label="Palavra do ciclo" /></form>}
              <label className="field"><span>Por quê?</span><input className="input" value={why} maxLength={300} placeholder="Quero arriscar mais sem me cobrar tanto." onChange={(e) => setWhy(e.target.value)} /></label>
              <span className="mono muted" style={{ marginTop: 8 }}>Who is she?</span>
              <span className="caption muted" style={{ marginTop: -8 }}>Como você quer se ver no fim do ciclo. Uma frase por linha.</span>
              <ListInput label="Who is she" items={who} onChange={setWho} placeholder="Ela tem um emprego na área e ainda tem tempo para os amigos." />
              <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={busy} onClick={createCycle}>Criar o ciclo</button>
            </>
          )
        )}

        {step === 6 && (existingCycle ? (
          <>
            <GoalWizard inline cycleId={existingCycle.id} areas={areas} existing={steps} position={0} index={0} onDone={finish} onCancel={finish} />
            <button className="caption muted" style={{ alignSelf: 'center' }} onClick={finish}>Pular e ir para o Hoje</button>
          </>
        ) : <p className="muted">Criando o ciclo…</p>)}
      </main>
    </div>
  )
}

/** Etapa do Google: conecta pela mesma ligação das Configurações e mostra os calendários. */
function GoogleStep({ areas, onNext }: { areas: Area[]; onNext: () => void }) {
  const { rows } = useRows<Integration>('integrations', { columns: 'owner_id,provider,account_email,status,last_sync_at,last_error,created_at' }, !DEMO)
  const g = rows.find((r) => r.provider === 'google')
  const cals = useCalendars(areas)
  const [msg, setMsg] = useState('')
  useEffect(() => { if (g && !g.last_sync_at) { const t = setTimeout(() => setMsg('Buscando seus calendários…'), 0); return () => clearTimeout(t) } }, [g])
  async function connect() {
    try { const { url } = await callFunction<{ url: string }>('connect', { provider: 'google' }); location.assign(url) }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
  }
  const list = cals.list.filter((c) => c.key !== 'local')
  return (
    <>
      <h1 className="serif onb-title">Traga sua agenda do Google.</h1>
      <p className="muted" style={{ margin: 0 }}>Seus compromissos aparecem junto com o plano. Você escolhe quais calendários entram.</p>
      <div className="card row between">
        <div className="stack" style={{ gap: 0 }}><span className="caption muted">Conta Google</span><span className="medium">{g?.account_email ?? (DEMO ? 'Disponível com a conta online' : 'Não conectada')}</span></div>
        {g ? <span className="pill caption ok">conectada</span> : !DEMO && <button className="btn primary small" onClick={connect}>Conectar</button>}
      </div>
      {msg && <span className="caption muted">{msg}</span>}
      {list.length > 0 && (
        <>
          <span className="mono muted">Calendários</span>
          <div className="card flush list">
            {list.map((c) => (
              <div key={c.key} className="list-row"><span className="dot" style={{ width: 12, height: 12, background: c.color ?? 'var(--neutro-fg)' }} /><span className="grow">{c.name}</span>
                <Toggle label={`Mostrar ${c.name}`} on={c.visible} onChange={(v) => cals.toggle(c.key, v)} /></div>
            ))}
          </div>
        </>
      )}
      <span className="mono muted">Como sincronizar</span>
      <div className="stack" style={{ gap: 8 }}>
        <div className="choice" aria-disabled style={{ opacity: 0.55 }}><span className="medium">Nos dois sentidos <span className="pill caption">em breve</span></span><span className="caption muted">O que você criar aqui também vai para o Google.</span></div>
        <div className="choice on"><span className="medium">Só mostrar no app</span><span className="caption muted">O Google continua sendo o lugar de editar.</span></div>
      </div>
      <div className="row between"><button className="btn ghost" onClick={onNext}>Pular</button><button className="btn primary" onClick={onNext}>Continuar</button></div>
    </>
  )
}
