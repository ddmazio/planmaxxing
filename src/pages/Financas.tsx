import { useMemo, useState } from 'react'
import { useOutletContext } from 'react-router-dom'
import { insert, remove, saveRule, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { fmt, fromYmd, todayYmd } from '../lib/dates'
import { CURRENCIES, centsToInput, money, parseMoney } from '../lib/money'
import { CATS, CAT_COLOR, CAT_HINT, CAT_NAME, DEFAULT_RULE, inMonth, isBlue, milestone, monthName, nextMonth, prevMonth, streak, subsInMonth, summarize, ym, type Cat } from '../lib/finance'
import type { BudgetRule, Expense, Income, Pot, Subscription } from '../lib/types'
import { Empty, SectionHead, Sheet, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader, type ShellCtx } from '../components/Shell'

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function Financas() {
  const { profile } = useAuth()
  const cur = profile?.currency_main ?? 'EUR'
  const $ = (c: number) => money(c, cur)
  const thisMonth = ym(new Date())
  const [m, setM] = useState(thisMonth)
  const [adding, setAdding] = useState<null | 'out' | 'in'>(null)
  const [ruleOpen, setRuleOpen] = useState(false)
  const [filter, setFilter] = useState<'all' | 'in' | 'out'>('all')

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
  const run = streak(thisMonth, get, first)
  const ms = milestone(run)
  const last6 = Array.from({ length: 6 }, (_, i) => { let x = thisMonth; for (let j = 0; j < 5 - i; j++) x = prevMonth(x); return x })

  const entries = [
    ...inMonth(incomes, 'received_on', m).map((r) => ({ kind: 'in' as const, id: r.id, item: r.item, cents: r.amount_cents, date: r.received_on, recurring: r.recurring, cat: null as Cat | null, orig: r.original_currency ? money(r.original_amount_cents ?? 0, r.original_currency) : null })),
    ...inMonth(expenses, 'spent_on', m).map((r) => ({ kind: 'out' as const, id: r.id, item: r.item, cents: r.amount_cents, date: r.spent_on, recurring: r.recurring, cat: r.category as Cat, orig: r.original_currency ? money(r.original_amount_cents ?? 0, r.original_currency) : null })),
  ].filter((e) => filter === 'all' || e.kind === filter).sort((a, b) => (a.date < b.date ? 1 : -1))

  return (
    <div className="page wide">
      <PageHeader eyebrow="Finanças" title={
        <span className="row" style={{ gap: 6 }}>
          <button className="icon-btn" aria-label="Mês anterior" onClick={() => setM(prevMonth(m))}><Icon name="back" size={16} /></button>
          <span style={{ minWidth: 130, textAlign: 'center' }}>{cap(monthName(m))}</span>
          <button className="icon-btn" aria-label="Próximo mês" disabled={m >= thisMonth} onClick={() => setM(nextMonth(m))}><Icon name="chevron" size={16} /></button>
        </span>}
        right={<div className="row" style={{ gap: 8 }}>
          <button className="btn secondary small" onClick={() => setAdding('in')}><Icon name="plus" size={14} />Entrada</button>
          <button className="btn primary small" onClick={() => setAdding('out')}><Icon name="plus" size={14} />Gasto</button>
        </div>} />

      <div className="grid2">
        <div className="card ink stack" style={{ gap: 14 }}>
          <div className="row between"><span className="mono" style={{ opacity: 0.7 }}>Sobra em {monthName(m)}</span>
            {s.income > 0 && <span className="pill caption" style={{ background: isBlue(s) ? 'var(--lime)' : '#f1a3be', color: '#141414' }}>{isBlue(s) ? 'no azul' : 'no vermelho'}</span>}</div>
          <span className="big" style={{ fontSize: 48 }}>{$(s.left)}</span>
          <div className="row" style={{ gap: 20, flexWrap: 'wrap' }}>
            <span className="caption"><span style={{ opacity: 0.6 }}>Entrou </span>{$(s.income)}</span>
            <span className="caption"><span style={{ opacity: 0.6 }}>Gastou </span>{$(s.spent)}</span>
            <span className="caption"><span style={{ opacity: 0.6 }}>Guardou </span>{$(s.byCat.savings)}</span>
          </div>
          {s.income === 0 && <span className="caption" style={{ opacity: 0.75 }}>Lance o que entra no mês (salário, freelas) para ver quanto cabe em cada parte.</span>}
        </div>

        <div className={'card stack' + (run >= 3 ? ' lime' : '')} style={{ gap: 12 }}>
          <div className="row between"><span className="mono" style={{ opacity: 0.7 }}>Sequência no azul</span>
            {ms.reached > 0 && <span className="pill caption" style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}><Icon name="star" size={12} filled /> {ms.reached} {ms.reached === 1 ? 'mês' : 'meses'}</span>}</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big" style={{ fontSize: 48 }}>{run}</span><span>{run === 1 ? 'mês seguido' : 'meses seguidos'}</span></div>
          <div className="row" style={{ gap: 6, alignItems: 'flex-end' }} aria-label="Últimos 6 meses">
            {last6.map((x) => {
              const v = get(x); const blue = isBlue(v); const empty = v.income === 0 && v.spent === 0
              return (
                <div key={x} className="stack grow" style={{ gap: 4, alignItems: 'center' }}>
                  <span style={{ width: '100%', height: 28, borderRadius: 8, background: empty ? 'transparent' : blue ? (x === thisMonth ? 'var(--lime)' : 'var(--ink)') : '#f1a3be', boxShadow: empty ? 'inset 0 0 0 1.5px var(--border)' : x === thisMonth ? 'inset 0 0 0 1.5px var(--ink)' : undefined }} />
                  <span className="mono" style={{ opacity: 0.7 }}>{fmt(fromYmd(x + '-01'), 'MMM')}</span>
                </div>
              )
            })}
          </div>
          <span className="caption" style={{ opacity: 0.8 }}>{run === 0 ? 'Feche um mês gastando menos do que entrou para começar a sequência.' : ms.next ? `Faltam ${ms.next - run} para a conquista de ${ms.next} meses.` : 'Você passou de 2 anos no azul. Incrível.'}</span>
        </div>
      </div>

      <SectionHead title={`Regra ${rule.needs_pct}/${rule.wants_pct}/${rule.savings_pct}`} action={<button className="caption muted" onClick={() => setRuleOpen(true)}>ajustar</button>} />
      <div className="blobs">
        {CATS.map((c) => <BlobCard key={c} cat={c} spent={s.byCat[c]} plan={s.plan[c]} fmt$={$} />)}
      </div>

      <div className="grid2">
        <div className="stack">
          <SectionHead title="Lançamentos" action={
            <div className="seg small">
              {(['all', 'in', 'out'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{f === 'all' ? 'Tudo' : f === 'in' ? 'Entradas' : 'Saídas'}</button>)}
            </div>} />
          {entries.length ? (
            <div className="card flush list">
              {entries.map((e) => (
                <div key={e.kind + e.id} className="list-row">
                  <span className="dot" style={{ width: 10, height: 10, background: e.kind === 'in' ? 'var(--ink)' : `var(--${CAT_COLOR[e.cat!]}-fg)` }} />
                  <div className="grow stack" style={{ gap: 2 }}>
                    <span>{e.item}</span>
                    <span className="caption muted">{e.recurring ? 'todo mês' : fmt(fromYmd(e.date), 'd MMM')}{e.cat ? ` · ${CAT_NAME[e.cat]}` : ''}{e.orig ? ` · ${e.orig}` : ''}</span>
                  </div>
                  <span className="medium" style={{ whiteSpace: 'nowrap' }}>{e.kind === 'in' ? '+ ' : '− '}{$(e.cents)}</span>
                  <button className="faint" aria-label={`Apagar ${e.item}`} onClick={() => { if (confirm(`Apagar “${e.item}”?${e.recurring ? ' Ele some de todos os meses.' : ''}`)) remove(e.kind === 'in' ? 'incomes' : 'expenses', e.id) }}><Icon name="x" size={16} /></button>
                </div>
              ))}
            </div>
          ) : <Empty>Nada lançado em {monthName(m)}. Use os botões acima ou o + (ex.: “almoço 12,50”).</Empty>}
        </div>

        <div className="stack">
          <Pots pots={pots} expenses={expenses} fmt$={$} />
          <Subs subs={subsInMonth(subs, m)} all={subs} fmt$={$} />
        </div>
      </div>

      <EntrySheet kind={adding} onClose={() => setAdding(null)} currency={cur} pots={pots} />
      <RuleSheet open={ruleOpen} onClose={() => setRuleOpen(false)} rule={rule} />
    </div>
  )
}

// ---------------------------------------------------------------- blob que "enche"
const BLOB = 'M64 8c20-1 38 12 46 30s4 42-10 56-36 20-56 14S12 92 8 72s0-40 14-52S44 9 64 8z'
function BlobCard({ cat, spent, plan, fmt$ }: { cat: Cat; spent: number; plan: number; fmt$: (c: number) => string }) {
  const pct = plan > 0 ? spent / plan : spent > 0 ? 1.01 : 0
  const level = Math.min(pct, 1)
  const over = cat !== 'savings' && pct > 1
  const goodSave = cat === 'savings' && pct >= 1
  const color = `var(--${CAT_COLOR[cat]}-fg)`
  const id = `clip-${cat}`
  const rest = plan - spent
  return (
    <div className="card stack blob-card" style={{ gap: 8 }}>
      <div className="row between"><span className="medium">{CAT_NAME[cat]}</span><span className="caption muted">{Math.round(pct * 100)}%</span></div>
      <svg viewBox="0 0 120 120" className="blob" role="img" aria-label={`${CAT_NAME[cat]}: ${fmt$(spent)} de ${fmt$(plan)}`}>
        <defs><clipPath id={id}><path d={BLOB} /></clipPath></defs>
        <path d={BLOB} fill={`var(--${CAT_COLOR[cat]}-bg)`} />
        <g clipPath={`url(#${id})`}>
          <rect x="0" y={120 - 120 * level} width="120" height={120 * level} fill={over ? 'var(--danger)' : color} style={{ transition: 'y .5s, height .5s' }} />
        </g>
        {(over || goodSave) && <text x="60" y="68" textAnchor="middle" fontSize="22" fill="#fff">{over ? '!' : '★'}</text>}
      </svg>
      <span className="medium">{fmt$(spent)} <span className="caption muted">de {fmt$(plan)}</span></span>
      <span className="caption muted">
        {plan === 0 ? CAT_HINT[cat] : cat === 'savings' ? (rest > 0 ? `faltam ${fmt$(rest)} para guardar` : 'meta do mês batida') : rest >= 0 ? `cabem mais ${fmt$(rest)}` : `passou ${fmt$(-rest)}`}
      </span>
    </div>
  )
}

// ---------------------------------------------------------------- lançar gasto ou entrada
function EntrySheet({ kind, onClose, currency, pots }: { kind: null | 'out' | 'in'; onClose: () => void; currency: string; pots: Pot[] }) {
  const { toast } = useOutletContext<ShellCtx>()
  const [k, setK] = useState<'out' | 'in'>('out')
  const [item, setItem] = useState('')
  const [val, setVal] = useState('')
  const [cur, setCur] = useState(currency)
  const [rate, setRate] = useState('')
  const [cat, setCat] = useState<Cat>('needs')
  const [pot, setPot] = useState('')
  const [date, setDate] = useState(todayYmd())
  const [rec, setRec] = useState(false)
  const [lastKind, setLastKind] = useState<typeof kind>(null)
  if (kind !== lastKind) { setLastKind(kind); if (kind) { setK(kind); setRec(kind === 'in'); setCur(currency) } }

  const foreign = cur !== currency
  const cents = parseMoney(val)
  const fx = foreign ? Number(rate.replace(',', '.')) : 1
  const fxOk = !foreign || (fx > 0 && fx < 1e6)
  const converted = cents != null && fxOk ? Math.round(cents * fx) : null
  const pickCur = (c: string) => { setCur(c); if (c !== currency) { try { setRate(localStorage.getItem(`fx:${c}:${currency}`) ?? '') } catch { setRate('') } } }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (!item.trim() || converted == null) return
    const extra = foreign ? { original_amount_cents: cents, original_currency: cur, fx_rate: fx } : {}
    if (foreign) try { localStorage.setItem(`fx:${cur}:${currency}`, rate) } catch { /* sem armazenamento */ }
    try {
      if (k === 'in') await insert<Income>('incomes', { item: item.trim(), amount_cents: converted, received_on: date, recurring: rec, ...extra })
      else await insert<Expense>('expenses', { item: item.trim(), amount_cents: converted, category: cat, spent_on: date, recurring: rec, pot_id: cat === 'savings' && pot ? pot : null, ...extra })
      setItem(''); setVal(''); onClose()
      toast(k === 'in' ? 'Entrada lançada' : 'Gasto lançado')
    } catch (err) { toast(err instanceof Error ? err.message : 'Não deu para guardar') }
  }

  return (
    <Sheet open={!!kind} onClose={onClose} title={k === 'in' ? 'Nova entrada' : 'Novo gasto'} labelledBy="entry-sheet">
      <form className="stack" onSubmit={save}>
        <div className="seg">
          <button type="button" className={k === 'out' ? 'on' : ''} onClick={() => { setK('out'); setRec(false) }}>Gasto</button>
          <button type="button" className={k === 'in' ? 'on' : ''} onClick={() => { setK('in'); setRec(true) }}>Entrada</button>
        </div>
        <label className="field"><span>Descrição</span><input className="input" autoFocus value={item} maxLength={120} placeholder={k === 'in' ? 'Salário, freela…' : 'Mercado, aluguel…'} onChange={(e) => setItem(e.target.value)} /></label>
        <div className="row" style={{ alignItems: 'flex-end' }}>
          <label className="field grow"><span>Valor</span><input className="input" inputMode="decimal" value={val} placeholder="0,00" onChange={(e) => setVal(e.target.value)} aria-invalid={!!val && cents == null} /></label>
          <label className="field" style={{ width: 120 }}><span>Moeda</span>
            <select className="input" value={cur} onChange={(e) => pickCur(e.target.value)}>{CURRENCIES.map(([c]) => <option key={c}>{c}</option>)}</select></label>
        </div>
        {foreign && (
          <label className="field"><span>Câmbio: 1 {cur} = quantos {currency}?</span>
            <input className="input" inputMode="decimal" value={rate} placeholder="Ex.: 0,17" onChange={(e) => setRate(e.target.value)} />
            {converted != null && <span className="caption muted">Fica {money(converted, currency)} no seu mês. Guardo o valor original também.</span>}
          </label>
        )}
        {k === 'out' && (
          <div className="field"><span>Parte do orçamento</span>
            <div className="chips">{CATS.map((c) => <button type="button" key={c} className={'chip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>{CAT_NAME[c]}</button>)}</div>
            <span className="caption muted">{CAT_HINT[cat]}</span>
          </div>
        )}
        {k === 'out' && cat === 'savings' && pots.length > 0 && (
          <label className="field"><span>Vai para o pote</span>
            <select className="input" value={pot} onChange={(e) => setPot(e.target.value)}><option value="">Nenhum</option>{pots.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        )}
        <label className="field"><span>Data</span><input type="date" className="input" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        <div className="row between"><span>Repete todo mês</span><Toggle label="Repete todo mês" on={rec} onChange={setRec} /></div>
        <button className="btn primary" disabled={!item.trim() || converted == null}>Guardar</button>
      </form>
    </Sheet>
  )
}

function RuleSheet({ open, onClose, rule }: { open: boolean; onClose: () => void; rule: BudgetRule }) {
  const [n, setN] = useState(rule.needs_pct)
  const [w, setW] = useState(rule.wants_pct)
  const sv = 100 - n - w
  const ok = sv >= 0
  return (
    <Sheet open={open} onClose={onClose} title="Sua regra" labelledBy="rule-sheet">
      <p className="muted" style={{ margin: 0 }}>Como dividir o que entra. A clássica é 50/30/20, mas a regra é sua.</p>
      {([['Essenciais', n, setN], ['Desejos', w, setW]] as const).map(([l, v, set]) => (
        <label key={l} className="stack" style={{ gap: 4 }}>
          <span className="row between"><span>{l}</span><span className="medium">{v}%</span></span>
          <input type="range" min={0} max={100} step={5} value={v} onChange={(e) => set(Number(e.target.value))} />
        </label>
      ))}
      <div className="row between"><span>Futuro</span><span className="medium" style={{ color: ok ? undefined : 'var(--danger)' }}>{ok ? `${sv}%` : 'passa de 100%'}</span></div>
      <div className="row" style={{ gap: 8 }}>
        <button className="btn secondary grow" onClick={() => { setN(50); setW(30) }}>Voltar a 50/30/20</button>
        <button className="btn primary grow" disabled={!ok} onClick={async () => { await saveRule({ needs_pct: n, wants_pct: w, savings_pct: sv }); onClose() }}>Guardar</button>
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
            <div className="bar"><span style={{ width: `${pct}%`, background: pct >= 100 ? 'var(--saude-fg)' : undefined }} /></div>
            <span className="caption muted">{fmt$(saved)} de {fmt$(p.target_cents)}{pct >= 100 ? ' · conseguiu!' : ''}</span>
          </div>
        )
      }) : <Empty>Potes juntam dinheiro para um sonho: viagem, reserva, um curso. Lance um gasto em Futuro e escolha o pote.</Empty>}
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

