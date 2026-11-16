import { useEffect, useMemo, useState } from 'react'
import { useOutletContext, useSearchParams } from 'react-router-dom'
import { insert, remove, saveRule, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, todayYmd, ymd } from '../lib/dates'
import { CURRENCIES, CURRENCY_INFO, centsToInput, money, moneyParts, parseMoney } from '../lib/money'
import { CATS, CAT_COLOR, CAT_HINT, CAT_NAME, CAT_ONE, DEFAULT_RULE, inMonth, isBlue, monthName, nextMonth, prevMonth, streak, subsInMonth, suggestCat, summarize, ym, type Cat } from '../lib/finance'
import type { BudgetRule, Expense, Income, Pot, Subscription } from '../lib/types'
import { Empty, SectionHead, Sheet, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { type ShellCtx } from '../components/Shell'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const LETTERS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D']
type Tab = 'resumo' | 'lancamentos'

function Big({ cents, cur, size = 36 }: { cents: number; cur: string; size?: number }) {
  const [a, b] = moneyParts(cents, cur)
  return <span className="big money-big" style={{ fontSize: size }}>{a}<small>{b}</small></span>
}

const when = (d: string) => { const t = todayYmd(); return d === t ? 'hoje' : d === ymd(addDays(fromYmd(t), -1)) ? 'ontem' : fmt(fromYmd(d), 'd MMM') }

export function Financas() {
  const { profile } = useAuth()
  const cur = profile?.currency_main ?? 'EUR'
  const $ = (c: number) => money(c, cur)
  const thisMonth = ym(new Date())
  const [m, setM] = useState(thisMonth)
  const [sp, setSp] = useSearchParams()
  const tab: Tab = sp.get('aba') === 'lancamentos' ? 'lancamentos' : 'resumo'
  const setTab = (t: Tab) => { const n = new URLSearchParams(sp); if (t === 'resumo') n.delete('aba'); else n.set('aba', t); setSp(n, { replace: true }) }
  const [adding, setAdding] = useState<null | 'out' | 'in'>(null)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [curOpen, setCurOpen] = useState(false)

  const { rows: incomes } = useRows<Income>('incomes', { order: { column: 'received_on', ascending: false } })
  const { rows: expenses } = useRows<Expense>('expenses', { order: { column: 'spent_on', ascending: false } })
  const { rows: subs } = useRows<Subscription>('subscriptions', { order: { column: 'billing_day' } })
  const { rows: pots } = useRows<Pot>('pots')
  const { rows: rules } = useRows<BudgetRule>('budget_rules')
  const rule = rules[0] ?? DEFAULT_RULE

  const get = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof summarize>>()
    return (x: string) => { if (!cache.has(x)) cache.set(x, summarize(x, incomes, expenses, subs, rule)); return cache.get(x)! }
  }, [incomes, expenses, subs, rule])
  const first = useMemo(() => {
    const dates = [...incomes.map((i) => i.received_on), ...expenses.map((e) => e.spent_on)].sort()
    return dates[0]?.slice(0, 7) ?? null
  }, [incomes, expenses])
  const s = get(m)
  const prev = get(prevMonth(m))
  const out = s.spent + s.byCat.savings
  const run = streak(thisMonth, get, first)
  const monthIncomes = inMonth(incomes, 'received_on', m)
  const monthExpenses = inMonth(expenses, 'spent_on', m)
  const potSaved = (p: Pot) => expenses.filter((e) => e.pot_id === p.id).reduce((a, e) => a + e.amount_cents, 0)
  const reserve = [...pots].sort((a, b) => Number(/reserv|emerg/i.test(b.name)) - Number(/reserv|emerg/i.test(a.name)))[0]
  const diff = s.left - prev.left
  const hasPrev = prev.income > 0 || prev.spent > 0

  const recent = [
    ...monthIncomes.map((r) => ({ kind: 'in' as const, id: r.id, item: r.item, cents: r.amount_cents, date: r.recurring ? (r.received_on < `${m}-01` ? `${m}-${r.received_on.slice(8)}` : r.received_on) : r.received_on })),
    ...monthExpenses.map((r) => ({ kind: 'out' as const, id: r.id, item: r.item, cents: r.amount_cents, date: r.recurring ? (r.spent_on < `${m}-01` ? `${m}-${r.spent_on.slice(8)}` : r.spent_on) : r.spent_on })),
  ].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 6)

  // conquista: o mês passado fechou no azul (mostra uma vez por mês)
  const lastM = prevMonth(thisMonth)
  const lastS = get(lastM)
  const lastRun = streak(lastM, get, first)
  const seenKey = `conquista:${lastM}`
  const [won, setWon] = useState(false)
  useEffect(() => {
    if (!first || first > lastM || !isBlue(lastS)) return
    try { if (!localStorage.getItem(seenKey)) setWon(true) } catch { /* sem armazenamento */ }
  }, [first, lastM, lastS, seenKey])
  const closeWon = () => { try { localStorage.setItem(seenKey, '1') } catch { /* */ } setWon(false) }

  return (
    <div className="page wide">
      <header className="row between fin-head">
        <div className="row" style={{ gap: 4 }}>
          <button className="icon-btn" aria-label="Mês anterior" onClick={() => setM(prevMonth(m))}><Icon name="back" size={16} /></button>
          <h1 className="h1" style={{ minWidth: 0 }}>{cap(monthName(m))} {m.slice(0, 4)}</h1>
          <button className="icon-btn" aria-label="Próximo mês" disabled={m >= thisMonth} onClick={() => setM(nextMonth(m))}><Icon name="chevron" size={16} /></button>
        </div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn secondary small" onClick={() => setCurOpen(true)} aria-label="Moeda">{CURRENCY_INFO[cur]?.symbol ?? ''} {cur}</button>
          <div className="seg small" role="tablist">
            <button role="tab" aria-selected={tab === 'resumo'} className={tab === 'resumo' ? 'on' : ''} onClick={() => setTab('resumo')}>Resumo</button>
            <button role="tab" aria-selected={tab === 'lancamentos'} className={tab === 'lancamentos' ? 'on' : ''} onClick={() => setTab('lancamentos')}>Lançamentos</button>
          </div>
          <button className="btn primary small" onClick={() => setAdding('out')}><Icon name="plus" size={14} />Lançar</button>
        </div>
      </header>

      {tab === 'resumo' ? (
        <>
          <div className="kpis">
            <div className="card ink stack kpi">
              <Big cents={s.left} cur={cur} />
              <span className="caption" style={{ opacity: 0.7 }}>Sobra do mês{hasPrev ? ` · ${$(Math.abs(diff))} a ${diff >= 0 ? 'mais' : 'menos'} que ${monthName(prevMonth(m))}` : ''}</span>
            </div>
            <div className="card stack kpi">
              <Big cents={s.income} cur={cur} />
              <span className="caption muted">Renda · {monthIncomes.length} fonte{monthIncomes.length === 1 ? '' : 's'}</span>
            </div>
            <div className="card stack kpi">
              <Big cents={out} cur={cur} />
              <span className="caption muted">Gastos{s.income ? ` · ${Math.round((out / s.income) * 100)}% da renda` : ''}</span>
            </div>
            <div className="card stack kpi">
              {reserve ? <>
                <span className="big" style={{ fontSize: 36 }}>{Math.min(100, Math.round((potSaved(reserve) / reserve.target_cents) * 100))}%</span>
                <span className="caption muted">{reserve.name} · {$(potSaved(reserve))} de {$(reserve.target_cents)}</span>
              </> : <>
                <span className="big" style={{ fontSize: 36 }}>–</span>
                <span className="caption muted">Reserva · crie um pote abaixo</span>
              </>}
            </div>
          </div>

          <div className="fin-grid">
            <div className="card stack">
              <div className="row between"><div className="stack" style={{ gap: 0 }}><span className="h3">Orçamento usado</span><span className="mono muted">{rule.needs_pct} / {rule.wants_pct} / {rule.savings_pct}</span></div>
                <button className="btn secondary small" onClick={() => setRuleOpen(true)}>Editar regra</button></div>
              <div className="budget">
                <Rings s={s} />
                <div className="stack grow" style={{ gap: 14 }}>
                  {CATS.map((c) => <BudgetRow key={c} cat={c} spent={s.byCat[c]} plan={s.plan[c]} fmt$={$} />)}
                </div>
              </div>
            </div>

            <div className="card stack">
              <div className="row between"><span className="h3">Sequência</span></div>
              <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big" style={{ fontSize: 48 }}>{run}</span><span>{run === 1 ? 'mês no azul' : 'meses no azul'}</span></div>
              <div className="year-strip" aria-label={`Meses de ${thisMonth.slice(0, 4)}`}>
                {LETTERS.map((l, i) => {
                  const x = `${thisMonth.slice(0, 4)}-${String(i + 1).padStart(2, '0')}`
                  const v = get(x); const future = x > thisMonth; const empty = future || (v.income === 0 && v.spent === 0)
                  const state = future ? 'future' : empty ? 'none' : x === thisMonth ? (isBlue(v) ? 'now' : 'now red') : isBlue(v) ? 'blue' : 'red'
                  return <div key={x} className="ys"><span className={'ys-bar ' + state} title={`${cap(monthName(x))}: ${empty ? 'sem lançamentos' : isBlue(v) ? 'no azul' : 'no vermelho'}`} /><span className="mono faint">{l}</span></div>
                })}
              </div>
              <span className="caption muted">{run === 0 ? 'Feche um mês gastando menos do que entrou para começar a sequência.' : isBlue(get(thisMonth)) ? `Mantenha ${monthName(thisMonth)} no azul até o fim e feche ${run} ${run === 1 ? 'mês' : 'meses'} seguidos.` : `Feche ${monthName(thisMonth)} no azul e chegue a ${run + 1} meses seguidos.`}</span>
            </div>
          </div>

          <div className="fin-grid">
            <div className="stack">
              <SectionHead title="Últimos lançamentos" action={<button className="caption muted" onClick={() => setTab('lancamentos')}>Ver todos</button>} />
              {recent.length ? (
                <div className="card flush list">
                  {recent.map((e) => (
                    <div key={e.kind + e.id} className="list-row">
                      <span className="grow">{e.item}</span>
                      <span className="caption muted" style={{ width: 52, textAlign: 'right' }}>{when(e.date)}</span>
                      <span className={'medium money-cell' + (e.kind === 'in' ? ' in' : '')}>{e.kind === 'in' ? '+ ' : '− '}{$(e.cents)}</span>
                    </div>
                  ))}
                </div>
              ) : <Empty>Nada lançado em {monthName(m)}. Use “Lançar” ou o + (ex.: “almoço 12,50”).</Empty>}
            </div>
            <div className="stack">
              <Pots pots={pots} expenses={expenses} fmt$={$} />
              <Subs subs={subsInMonth(subs, m)} all={subs} fmt$={$} />
            </div>
          </div>
        </>
      ) : (
        <Lancamentos m={m} expenses={monthExpenses} incomes={monthIncomes} subsTotal={s.subs} cur={cur} onAdd={setAdding} />
      )}

      <EntrySheet kind={adding} onClose={() => setAdding(null)} currency={cur} extra={profile?.currencies_extra ?? []} pots={pots} />
      <RuleSheet open={ruleOpen} onClose={() => setRuleOpen(false)} rule={rule} income={s.income} fmt$={$} />
      <CurrencySheet open={curOpen} onClose={() => setCurOpen(false)} />
      <Sheet open={won} onClose={closeWon} title="Conquista" labelledBy="win-sheet">
        <div className="stack" style={{ alignItems: 'center', textAlign: 'center' }}>
          <div className="win-badge"><span className="big">{lastRun}</span><span className="caption">{lastRun === 1 ? 'mês no azul' : 'meses no azul'}</span></div>
          <span className="h2">Mandou bem!</span>
          <p className="muted" style={{ margin: 0 }}>{cap(monthName(lastM))} fechou dentro do orçamento{lastRun > 1 ? `, pela ${lastRun}ª vez seguida` : ''}. {lastS.left > 0 ? `Os ${money(lastS.left, cur)} que sobraram podem ir para ${reserve ? `o pote ${reserve.name}` : 'a sua reserva'}.` : ''}</p>
          <button className="btn primary block" onClick={closeWon}>Continuar</button>
          <span className="caption faint">Os valores das suas finanças nunca aparecem para o grupo.</span>
        </div>
      </Sheet>
    </div>
  )
}

// ---------------------------------------------------------------- anéis do orçamento
function Rings({ s }: { s: ReturnType<typeof summarize> }) {
  const R = [62, 46, 30]
  return (
    <svg viewBox="0 0 150 150" className="rings" role="img" aria-label="Orçamento usado por parte">
      {CATS.map((c, i) => {
        const r = R[i], len = 2 * Math.PI * r
        const pct = s.plan[c] > 0 ? s.byCat[c] / s.plan[c] : s.byCat[c] > 0 ? 1 : 0
        const over = c !== 'savings' && pct > 1
        return (
          <g key={c}>
            <circle cx="75" cy="75" r={r} fill="none" stroke={`var(--${CAT_COLOR[c]}-bg)`} strokeWidth="11" />
            <circle cx="75" cy="75" r={r} fill="none" stroke={over ? 'var(--danger)' : `var(--${CAT_COLOR[c]}-bg)`} strokeWidth="11" strokeLinecap="round"
              strokeDasharray={`${len * Math.min(pct, 1)} ${len}`} transform="rotate(-90 75 75)" style={{ transition: 'stroke-dasharray .5s' }} />
          </g>
        )
      })}
    </svg>
  )
}

function BudgetRow({ cat, spent, plan, fmt$ }: { cat: Cat; spent: number; plan: number; fmt$: (c: number) => string }) {
  const pct = plan > 0 ? Math.round((spent / plan) * 100) : spent > 0 ? 100 : 0
  const rest = plan - spent
  const msg = plan === 0 ? CAT_HINT[cat]
    : cat === 'savings' ? (rest <= 0 ? 'Meta do mês batida.' : `Faltam ${fmt$(rest)} para guardar.`)
    : rest < 0 ? `Passou ${fmt$(-rest)}.` : pct >= 85 ? `Quase no limite. Restam ${fmt$(rest)}.` : `Com folga. Restam ${fmt$(rest)}.`
  return (
    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
      <span className="dot" style={{ width: 10, height: 10, marginTop: 6, background: `var(--${CAT_COLOR[cat]}-bg)` }} />
      <div className="grow stack" style={{ gap: 2 }}>
        <div className="row between"><span className="medium">{CAT_NAME[cat]}</span><span className="mono muted">{pct}%</span></div>
        <span className="caption">{fmt$(spent)} <span className="muted">de {fmt$(plan)}</span></span>
        <span className={'caption ' + (rest < 0 && cat !== 'savings' ? 'danger' : 'muted')}>{msg}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- aba Lançamentos
type Sort = 'valor' | 'data' | 'nome'
function Lancamentos({ m, expenses, incomes, subsTotal, cur, onAdd }: { m: string; expenses: Expense[]; incomes: Income[]; subsTotal: number; cur: string; onAdd: (k: 'out' | 'in') => void }) {
  const $ = (c: number) => money(c, cur)
  const [sort, setSort] = useState<Sort>('valor')
  const rows = [...expenses].sort((a, b) => sort === 'valor' ? b.amount_cents - a.amount_cents : sort === 'data' ? (a.spent_on < b.spent_on ? 1 : -1) : a.item.localeCompare(b.item))
  const total = expenses.reduce((a, e) => a + e.amount_cents, 0) + subsTotal
  const inTotal = incomes.reduce((a, e) => a + e.amount_cents, 0)
  const nextSort: Record<Sort, Sort> = { valor: 'data', data: 'nome', nome: 'valor' }
  const cycleCat = (e: Expense) => update<Expense>('expenses', e.id, { category: CATS[(CATS.indexOf(e.category) + 1) % 3] })
  return (
    <div className="fin-grid wide-left">
      <div className="stack">
        <div className="row between"><span className="mono muted">Despesas · {$(total)}</span>
          <button className="caption muted" onClick={() => setSort(nextSort[sort])}>Ordenar: {sort} {sort === 'valor' ? '↓' : sort === 'data' ? '↓' : 'A→Z'}</button></div>
        <div className="card flush ledger" role="table" aria-label={`Despesas de ${monthName(m)}`}>
          <div className="lg-row lg-head mono faint" role="row"><span>Item</span><span>Tipo</span><span>Frequência</span><span className="r">Valor</span><span>Notas</span><span /></div>
          {rows.map((e) => (
            <div key={e.id} className="lg-row" role="row">
              <span className="lg-item">{e.item}{e.original_currency && <span className="caption muted"> · {money(e.original_amount_cents ?? 0, e.original_currency)}</span>}</span>
              <span><button className="tag" style={{ background: `var(--${CAT_COLOR[e.category]}-bg)`, color: `var(--${CAT_COLOR[e.category]}-fg)` }} onClick={() => cycleCat(e)} title="Tocar para trocar o tipo">{CAT_ONE[e.category]}</button></span>
              <span><button className="caption muted" onClick={() => update<Expense>('expenses', e.id, { recurring: !e.recurring })} title="Tocar para trocar">{e.recurring ? 'todo mês' : `uma vez · ${fmt(fromYmd(e.spent_on), 'd MMM')}`}</button></span>
              <span className="r medium">{$(e.amount_cents)}</span>
              <span><input className="input bare caption" placeholder="nota" defaultValue={e.notes ?? ''} maxLength={300} aria-label={`Nota de ${e.item}`}
                onBlur={(ev) => { const v = ev.target.value.trim() || null; if (v !== (e.notes ?? null)) update<Expense>('expenses', e.id, { notes: v }) }} /></span>
              <span className="r"><button className="faint" aria-label={`Apagar ${e.item}`} onClick={() => { if (confirm(`Apagar “${e.item}”?${e.recurring ? ' Ele some de todos os meses.' : ''}`)) remove('expenses', e.id) }}><Icon name="x" size={14} /></button></span>
            </div>
          ))}
          {subsTotal > 0 && <div className="lg-row" role="row"><span className="lg-item muted">Assinaturas</span><span><span className="tag" style={{ background: 'var(--relacoes-bg)', color: 'var(--relacoes-fg)' }}>Desejo</span></span><span className="caption muted">todo mês</span><span className="r medium">{$(subsTotal)}</span><span className="caption muted">da lista de assinaturas</span><span /></div>}
          <button className="list-row muted" onClick={() => onAdd('out')}><Icon name="plus" size={16} />Adicionar despesa</button>
          <div className="lg-row lg-foot"><span className="medium">Total</span><span /><span /><span className="r medium">{$(total)}</span><span /><span /></div>
        </div>
      </div>
      <div className="stack">
        <div className="row between"><span className="mono muted">Renda</span><button className="caption medium" onClick={() => onAdd('in')}>+ fonte</button></div>
        <div className="card flush list">
          {incomes.map((r) => (
            <div key={r.id} className="list-row">
              <div className="grow stack" style={{ gap: 2 }}><span>{r.item}</span>
                <span className="caption muted">{r.original_currency ? `${money(r.original_amount_cents ?? 0, r.original_currency)} · convertido` : r.recurring ? `fixo · dia ${Number(r.received_on.slice(8))}` : `uma vez · ${fmt(fromYmd(r.received_on), 'd MMM')}`}</span></div>
              <span className="medium">{$(r.amount_cents)}</span>
              <button className="faint" aria-label={`Apagar ${r.item}`} onClick={() => { if (confirm(`Apagar “${r.item}”?${r.recurring ? ' Ela some de todos os meses.' : ''}`)) remove('incomes', r.id) }}><Icon name="x" size={14} /></button>
            </div>
          ))}
          {!incomes.length && <div className="list-row caption muted">Nenhuma renda em {monthName(m)}.</div>}
          <div className="list-row"><span className="grow medium">Total</span><span className="medium">{$(inTotal)}</span></div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- lançar
function EntrySheet({ kind, onClose, currency, extra, pots }: { kind: null | 'out' | 'in'; onClose: () => void; currency: string; extra: string[]; pots: Pot[] }) {
  const { toast } = useOutletContext<ShellCtx>()
  const [k, setK] = useState<'out' | 'in'>('out')
  const [item, setItem] = useState('')
  const [val, setVal] = useState('')
  const [cur, setCur] = useState(currency)
  const [rate, setRate] = useState('')
  const [cat, setCat] = useState<Cat | null>(null)
  const [pot, setPot] = useState('')
  const [date, setDate] = useState(todayYmd())
  const [rec, setRec] = useState(false)
  const [notes, setNotes] = useState('')
  const [pickCurOpen, setPickCurOpen] = useState(false)
  const [lastKind, setLastKind] = useState<typeof kind>(null)
  if (kind !== lastKind) { setLastKind(kind); if (kind) { setK(kind); setRec(kind === 'in'); setCur(currency); setCat(null) } }

  const sug = suggestCat(item)
  const chosen: Cat = cat ?? sug?.cat ?? 'needs'
  const foreign = cur !== currency
  const cents = parseMoney(val)
  const fx = foreign ? Number(rate.replace(',', '.')) : 1
  const fxOk = !foreign || (fx > 0 && fx < 1e6)
  const converted = cents != null && fxOk ? Math.round(cents * fx) : null
  const pickCur = (c: string) => { setCur(c); setPickCurOpen(false); if (c !== currency) { try { setRate(localStorage.getItem(`fx:${c}:${currency}`) ?? '') } catch { setRate('') } } }
  const quick = [currency, ...extra.filter((c) => c !== currency)]

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!item.trim() || converted == null) return
    const ex = foreign ? { original_amount_cents: cents, original_currency: cur, fx_rate: fx } : {}
    if (foreign) try { localStorage.setItem(`fx:${cur}:${currency}`, rate) } catch { /* sem armazenamento */ }
    try {
      if (k === 'in') await insert<Income>('incomes', { item: item.trim(), amount_cents: converted, received_on: date, recurring: rec, ...ex })
      else await insert<Expense>('expenses', { item: item.trim(), amount_cents: converted, category: chosen, spent_on: date, recurring: rec, notes: notes.trim() || null, pot_id: chosen === 'savings' && pot ? pot : null, ...ex })
      setItem(''); setVal(''); setNotes(''); onClose()
      toast(k === 'in' ? 'Entrada lançada' : 'Gasto lançado')
    } catch (err) { toast(err instanceof Error ? err.message : 'Não deu para guardar') }
  }

  return (
    <Sheet open={!!kind} onClose={onClose} title={k === 'in' ? 'Nova entrada' : 'Lançar gasto'} labelledBy="entry-sheet">
      <form className="stack" onSubmit={save}>
        <div className="seg">
          <button type="button" className={k === 'out' ? 'on' : ''} onClick={() => { setK('out'); setRec(false) }}>Gasto</button>
          <button type="button" className={k === 'in' ? 'on' : ''} onClick={() => { setK('in'); setRec(true) }}>Entrada</button>
        </div>
        <div className="stack amount-box">
          <input className="amount-input" inputMode="decimal" autoFocus value={val} placeholder={`${CURRENCY_INFO[cur]?.symbol ?? cur} 0,00`} onChange={(e) => setVal(e.target.value)} aria-label="Valor" aria-invalid={!!val && cents == null} />
          <button type="button" className="caption muted" onClick={() => setPickCurOpen(!pickCurOpen)}>{cur} · trocar moeda</button>
          {pickCurOpen && <div className="chips" style={{ justifyContent: 'center' }}>{[...quick, ...CURRENCIES.map(([c]) => c).filter((c) => !quick.includes(c))].map((c) => <button type="button" key={c} className={'chip' + (c === cur ? ' on' : '')} onClick={() => pickCur(c)}>{CURRENCY_INFO[c]?.symbol} {c}</button>)}</div>}
        </div>
        {foreign && (
          <label className="field"><span>Câmbio: 1 {cur} = quantos {currency}?</span>
            <input className="input" inputMode="decimal" value={rate} placeholder="Ex.: 0,17" onChange={(e) => setRate(e.target.value)} />
            {converted != null && <span className="caption muted">Fica {money(converted, currency)} no seu mês. O valor original fica guardado.</span>}
          </label>
        )}
        <label className="field"><span>{k === 'in' ? 'De onde veio' : 'O que foi'}</span><input className="input" value={item} maxLength={120} placeholder={k === 'in' ? 'Estágio, freela…' : 'Almoço com a Marta, supermercado…'} onChange={(e) => setItem(e.target.value)} /></label>
        {k === 'out' && (
          <div className="field"><span>Tipo</span>
            <div className="chips">{CATS.map((c) => <button type="button" key={c} className={'chip' + (chosen === c ? ' on' : '')} onClick={() => setCat(c)}>{CAT_ONE[c]}</button>)}</div>
            <span className="caption muted">{sug && !cat ? `Sugestão: ${sug.why} costuma${sug.why.includes(' e ') ? 'm' : ''} ser ${CAT_ONE[sug.cat].toLowerCase()}.` : CAT_HINT[chosen]}</span>
          </div>
        )}
        {k === 'out' && chosen === 'savings' && pots.length > 0 && (
          <label className="field"><span>Vai para o pote</span>
            <select className="input" value={pot} onChange={(e) => setPot(e.target.value)}><option value="">Nenhum</option>{pots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        )}
        <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className="field grow"><span>Data</span><input type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
          {k === 'out' && <label className="field grow"><span>Nota (opcional)</span><input className="input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>}
        </div>
        <div className="row between"><div className="stack" style={{ gap: 0 }}><span>Repetir todo mês</span><span className="caption muted">{k === 'in' ? 'Para o salário ou bolsa' : 'Para contas fixas, como a renda de casa'}</span></div><Toggle label="Repetir todo mês" on={rec} onChange={setRec} /></div>
        <div className="row" style={{ gap: 8 }}>
          <button type="button" className="btn secondary grow" onClick={onClose}>Cancelar</button>
          <button className="btn primary grow" disabled={!item.trim() || converted == null}>Lançar</button>
        </div>
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------- regra do orçamento
const PRESETS: { n: number; w: number; s: number; title: string; hint: string }[] = [
  { n: 50, w: 30, s: 20, title: '50 / 30 / 20', hint: 'O ponto de partida mais comum.' },
  { n: 70, w: 20, s: 10, title: '70 / 20 / 10', hint: 'Quando as necessidades pesam mais (ex.: aluguel alto).' },
]
function RuleSheet({ open, onClose, rule, income, fmt$ }: { open: boolean; onClose: () => void; rule: BudgetRule; income: number; fmt$: (c: number) => string }) {
  const [n, setN] = useState(rule.needs_pct)
  const [w, setW] = useState(rule.wants_pct)
  const [custom, setCustom] = useState(false)
  const [last, setLast] = useState(open)
  if (open !== last) { setLast(open); if (open) { setN(rule.needs_pct); setW(rule.wants_pct); setCustom(!PRESETS.some((p) => p.n === rule.needs_pct && p.w === rule.wants_pct)) } }
  const sv = 100 - n - w
  const ok = sv >= 0
  const pctOf = { needs: n, wants: w, savings: sv }
  return (
    <Sheet open={open} onClose={onClose} title="Orçamento" labelledBy="rule-sheet">
      <span className="h3">Como você quer dividir sua renda?</span>
      <p className="caption muted" style={{ margin: 0 }}>Dá para mudar quando quiser. A regra vale para todos os meses.</p>
      <div className="stack" style={{ gap: 8 }}>
        {PRESETS.map((p) => {
          const on = !custom && n === p.n && w === p.w
          return <button key={p.title} className={'choice' + (on ? ' on' : '')} onClick={() => { setCustom(false); setN(p.n); setW(p.w) }}><span className="medium">{p.title}</span><span className="caption muted">{p.hint}</span></button>
        })}
        <button className={'choice' + (custom ? ' on' : '')} onClick={() => setCustom(true)}><span className="medium">Personalizada</span><span className="caption muted">Você define os três números.</span></button>
      </div>
      {custom && ([['Necessidades', n, setN], ['Desejos', w, setW]] as const).map(([l, v, set]) => (
        <label key={l} className="stack" style={{ gap: 4 }}>
          <span className="row between"><span>{l}</span><span className="medium">{v}%</span></span>
          <input type="range" min={0} max={100} step={5} value={v} onChange={(e) => set(Number(e.target.value))} />
        </label>
      ))}
      <span className="mono muted">{income ? `Com renda de ${fmt$(income)}` : 'Sem renda lançada neste mês'}</span>
      <div className="card flush list">
        {CATS.map((c) => (
          <div key={c} className="list-row">
            <span className="dot" style={{ width: 10, height: 10, background: `var(--${CAT_COLOR[c]}-bg)` }} />
            <div className="grow stack" style={{ gap: 0 }}><span>{CAT_NAME[c]} · {pctOf[c] < 0 ? '–' : `${pctOf[c]}%`}</span><span className="caption muted">{CAT_HINT[c]}</span></div>
            <span className="medium">{income && pctOf[c] >= 0 ? fmt$(Math.round((income * pctOf[c]) / 100)) : ''}</span>
          </div>
        ))}
      </div>
      {!ok && <span className="caption danger">A soma passa de 100%.</span>}
      <button className="btn primary" disabled={!ok} onClick={async () => { await saveRule({ needs_pct: n, wants_pct: w, savings_pct: sv }); onClose() }}>Guardar regra</button>
    </Sheet>
  )
}

// ---------------------------------------------------------------- moeda
export function CurrencySheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { profile, saveProfile } = useAuth()
  const [q, setQ] = useState('')
  const [main, setMain] = useState(profile?.currency_main ?? 'EUR')
  const [extra, setExtra] = useState<string[]>(profile?.currencies_extra ?? [])
  const [adding, setAdding] = useState(false)
  const [last, setLast] = useState(open)
  if (open !== last) { setLast(open); if (open) { setMain(profile?.currency_main ?? 'EUR'); setExtra(profile?.currencies_extra ?? []); setQ(''); setAdding(false) } }
  const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
  const list = CURRENCIES.map(([c]) => c).filter((c) => !q || norm(`${c} ${CURRENCY_INFO[c]?.name} ${CURRENCY_INFO[c]?.where}`).includes(norm(q)))
  const ex = extra[0]
  let rate: number | null = null
  try { rate = ex ? Number((localStorage.getItem(`fx:${ex}:${main}`) ?? '').replace(',', '.')) || null : null } catch { rate = null }
  const changed = main !== (profile?.currency_main ?? 'EUR')
  return (
    <Sheet open={open} onClose={onClose} title="Moeda" labelledBy="cur-sheet">
      <input className="input" placeholder="Buscar moeda ou país" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar moeda ou país" />
      <span className="mono muted">Moeda principal</span>
      <span className="caption muted" style={{ marginTop: -8 }}>Onde você vive e paga as contas. Todos os totais aparecem nela.</span>
      <div className="card flush list">
        {list.map((c) => (
          <button key={c} className="list-row" onClick={() => setMain(c)} aria-pressed={c === main}>
            <span className="cur-sym">{CURRENCY_INFO[c]?.symbol}</span>
            <div className="grow stack" style={{ gap: 0, textAlign: 'left' }}><span>{CURRENCY_INFO[c]?.name}</span><span className="caption muted">{c} · {CURRENCY_INFO[c]?.where}</span></div>
            {c === main && <Icon name="check" size={18} />}
          </button>
        ))}
      </div>
      {changed && <span className="caption danger">Os valores já lançados não são convertidos: eles passam a aparecer na nova moeda.</span>}
      <span className="mono muted">Também recebo em</span>
      <div className="chips">
        {extra.map((c) => <span key={c} className="chip on">{CURRENCY_INFO[c]?.symbol} {CURRENCY_INFO[c]?.name.split(' ')[0]}<button aria-label={`Tirar ${c}`} onClick={() => setExtra(extra.filter((x) => x !== c))}><Icon name="x" size={12} /></button></span>)}
        {adding ? CURRENCIES.map(([c]) => c).filter((c) => c !== main && !extra.includes(c)).map((c) => <button key={c} className="chip" onClick={() => { setExtra([...extra, c]); setAdding(false) }}>{CURRENCY_INFO[c]?.symbol} {c}</button>)
          : <button className="chip" onClick={() => setAdding(true)}><Icon name="plus" size={12} />Adicionar</button>}
      </div>
      {ex && <span className="caption muted">{rate ? `${money(185000, ex)} ≈ ${money(Math.round(185000 * rate), main)} pela última cotação que você usou. ` : ''}Lançamentos em {CURRENCY_INFO[ex]?.name.split(' ')[0].toLowerCase()} são convertidos pela cotação que você informar ao lançar. O valor original fica guardado.</span>}
      <div className="row" style={{ gap: 8 }}>
        <button className="btn secondary grow" onClick={onClose}>Cancelar</button>
        <button className="btn primary grow" onClick={async () => { await saveProfile({ currency_main: main, currencies_extra: extra.filter((c) => c !== main) }); onClose() }}>Salvar</button>
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------- potes
function Pots({ pots, expenses, fmt$ }: { pots: Pot[]; expenses: Expense[]; fmt$: (c: number) => string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [target, setTarget] = useState('')
  const t = parseMoney(target)
  return (
    <>
      <SectionHead title="Potes" action={<button className="btn secondary small" onClick={() => setOpen(true)}><Icon name="plus" size={14} />Pote</button>} />
      {pots.length ? pots.map((p) => {
        const saved = expenses.filter((e) => e.pot_id === p.id).reduce((s, e) => s + e.amount_cents, 0)
        const pct = Math.min(100, Math.round((saved / p.target_cents) * 100))
        return (
          <div key={p.id} className="card stack" style={{ gap: 8 }}>
            <div className="row between"><span className="medium">{p.name}</span>
              <button className="faint" aria-label={`Apagar pote ${p.name}`} onClick={() => confirm(`Apagar o pote “${p.name}”? Os lançamentos ficam.`) && remove('pots', p.id)}><Icon name="x" size={16} /></button></div>
            <div className="bar"><span style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--saude-bg)' : undefined }} /></div>
            <span className="caption muted">{fmt$(saved)} de {fmt$(p.target_cents)}{pct >= 100 ? ' · conseguiu!' : ''}</span>
          </div>
        )
      }) : <Empty>Potes juntam dinheiro para um sonho: viagem, reserva, um curso. Lance um gasto em Economias e escolha o pote.</Empty>}
      <Sheet open={open} onClose={() => setOpen(false)} title="Novo pote" labelledBy="pot-sheet">
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (!name.trim() || !t) return; await insert<Pot>('pots', { name: name.trim(), target_cents: t }); setName(''); setTarget(''); setOpen(false) }}>
          <label className="field"><span>Nome</span><input className="input" autoFocus value={name} maxLength={60} placeholder="Viagem ao Brasil" onChange={(e) => setName(e.target.value)} /></label>
          <label className="field"><span>Quanto quer juntar</span><input className="input" inputMode="decimal" value={target} placeholder="1500,00" onChange={(e) => setTarget(e.target.value)} /></label>
          <button className="btn primary" disabled={!name.trim() || !t}>Criar pote</button>
        </form>
      </Sheet>
    </>
  )
}

// ---------------------------------------------------------------- assinaturas
function Subs({ subs, all, fmt$ }: { subs: Subscription[]; all: Subscription[]; fmt$: (c: number) => string }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [val, setVal] = useState('')
  const [day, setDay] = useState(1)
  const v = parseMoney(val)
  const total = subs.reduce((s, x) => s + x.amount_cents, 0)
  const today = todayYmd()
  const stale = (x: Subscription) => !x.last_used_on || (fromYmd(today).getTime() - fromYmd(x.last_used_on).getTime()) / 864e5 > 30
  return (
    <>
      <SectionHead title="Assinaturas" action={<button className="btn secondary small" onClick={() => setOpen(true)}><Icon name="plus" size={14} />Assinatura</button>} />
      {all.length ? (
        <div className="card flush list">
          {all.map((x) => (
            <div key={x.id} className="list-row">
              <span className="step-no">dia {x.billing_day}</span>
              <div className="grow stack" style={{ gap: 2 }}>
                <span>{x.name}</span>
                {stale(x) ? <button className="caption link" style={{ textAlign: 'left' }} onClick={() => update<Subscription>('subscriptions', x.id, { last_used_on: today })}>Ainda usa? Toque se usou este mês</button>
                  : <span className="caption muted">usou em {fmt(fromYmd(x.last_used_on!), 'd MMM')}</span>}
              </div>
              <span className="medium">{fmt$(x.amount_cents)}</span>
              <button className="faint" aria-label={`Apagar ${x.name}`} onClick={() => confirm(`Cancelou “${x.name}”? Ela sai da lista.`) && remove('subscriptions', x.id)}><Icon name="x" size={16} /></button>
            </div>
          ))}
          <div className="list-row caption muted">Total {fmt$(total)} por mês, contado em Desejos.</div>
        </div>
      ) : <Empty>Liste o que cobra todo mês (streaming, apps, academia) para ver o total e lembrar de cancelar o que não usa.</Empty>}
      <Sheet open={open} onClose={() => setOpen(false)} title="Nova assinatura" labelledBy="sub-sheet">
        <form className="stack" onSubmit={async (e) => { e.preventDefault(); if (!name.trim() || v == null) return; await insert<Subscription>('subscriptions', { name: name.trim(), amount_cents: v, billing_day: day, last_used_on: today }); setName(''); setVal(''); setOpen(false) }}>
          <label className="field"><span>Nome</span><input className="input" autoFocus value={name} maxLength={60} placeholder="Spotify" onChange={(e) => setName(e.target.value)} /></label>
          <div className="row">
            <label className="field grow"><span>Valor por mês</span><input className="input" inputMode="decimal" value={val} placeholder={centsToInput(999)} onChange={(e) => setVal(e.target.value)} /></label>
            <label className="field" style={{ width: 110 }}><span>Cobra no dia</span><input className="input" type="number" min={1} max={31} value={day} onChange={(e) => setDay(Math.min(31, Math.max(1, Number(e.target.value) || 1)))} /></label>
          </div>
          <button className="btn primary" disabled={!name.trim() || v == null}>Guardar</button>
        </form>
      </Sheet>
    </>
  )
}

