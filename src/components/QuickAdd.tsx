import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { insert } from '../lib/db'
import { parseQuick, type QuickKind } from '../lib/parse'
import { fmt, fromYmd, toIso, todayYmd } from '../lib/dates'
import { money } from '../lib/money'
import { useAuth } from '../lib/auth'
import type { CalEvent, Expense, Habit, Task } from '../lib/types'
import { Sheet } from './ui'
import { Icon } from './Icon'

const KINDS: [QuickKind, string][] = [['task', 'Tarefa'], ['event', 'Compromisso'], ['expense', 'Gasto'], ['habit', 'Hábito']]
const CAT = { needs: 'Necessidades', wants: 'Desejos', savings: 'Economias' }
const WD = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']

export function QuickAdd({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (msg: string) => void }) {
  const [text, setText] = useState('')
  const [forced, setForced] = useState<QuickKind | null>(null)
  const [busy, setBusy] = useState(false)
  const nav = useNavigate()
  const { profile } = useAuth()
  const p = useMemo(() => parseQuick(text), [text])
  const kind = forced ?? p.kind
  const title = p.title || text.trim()

  const close = () => { setText(''); setForced(null); onClose() }

  const summary = () => {
    if (!title) return null
    if (kind === 'event') return `${p.date ? fmt(fromYmd(p.date), "EEEE, d MMM") : 'Hoje'} · ${p.time ?? '09:00'} às ${addHour(p.time ?? '09:00')}`
    if (kind === 'expense') return `${p.amountCents != null ? money(p.amountCents, profile?.currency_main) : 'sem valor'} · ${CAT[p.category ?? 'wants']}`
    if (kind === 'habit') return p.days.length ? p.days.map((d) => WD[d]).join(' · ') : 'todos os dias'
    return p.date ? `Para ${fmt(fromYmd(p.date), "EEEE, d 'de' MMM")}` : 'Sem data · vai para a Inbox'
  }

  const save = async () => {
    if (!title || busy) return
    setBusy(true)
    try {
      const today = todayYmd()
      if (kind === 'event') {
        const date = p.date ?? today, time = p.time ?? '09:00'
        await insert<CalEvent>('events', { title, starts_at: toIso(date, time), ends_at: toIso(date, addHour(time)), kind: 'appointment', all_day: false })
        onDone('Compromisso criado')
      } else if (kind === 'expense') {
        if (p.amountCents == null) { onDone('Escreva o valor, por exemplo “almoço 12,50”'); setBusy(false); return }
        await insert<Expense>('expenses', { item: title, amount_cents: p.amountCents, category: p.category ?? 'wants', recurring: false, spent_on: p.date ?? today })
        onDone('Gasto lançado')
      } else if (kind === 'habit') {
        await insert<Habit>('habits', { title, days: p.days.length ? p.days : [0, 1, 2, 3, 4, 5, 6], archived: false })
        onDone('Hábito criado')
      } else {
        await insert<Task>('tasks', { title, due_on: p.date, my_day: p.date === today ? today : null, important: false, position: Date.now() % 1e9 })
        onDone(p.date === today ? 'Tarefa adicionada ao Hoje' : 'Tarefa criada')
      }
      close()
    } catch (e) {
      onDone('Não deu para salvar. Tente de novo.')
      console.error(e)
    } finally { setBusy(false) }
  }

  return (
    <Sheet open={open} onClose={close} title="Novo" labelledBy="quick-title">
      <form onSubmit={(e) => { e.preventDefault(); save() }} className="stack">
        <label className="sr-only" htmlFor="quick-input">O que você quer adicionar?</label>
        <input id="quick-input" className="input" style={{ fontSize: 20, minHeight: 56, borderRadius: 18, background: 'var(--bg-muted)', border: 0 }}
          autoFocus placeholder="dentista sexta 15h" value={text} maxLength={300} onChange={(e) => setText(e.target.value)} autoComplete="off" />
        <div className="chips" role="radiogroup" aria-label="Tipo">
          {KINDS.map(([k, l]) => (
            <button type="button" key={k} role="radio" aria-checked={kind === k} className={'chip' + (kind === k ? ' on' : '')} onClick={() => setForced(k)}>{l}</button>
          ))}
        </div>
        {title && (
          <div className="card soft stack" style={{ gap: 8 }}>
            <span className="mono muted">Entendi assim</span>
            <div className="row">
              <div className="icon-btn" style={{ borderRadius: 12 }}><Icon name={kind === 'event' ? 'calendar' : kind === 'expense' ? 'wallet' : kind === 'habit' ? 'repeat' : 'check'} size={18} /></div>
              <div className="grow"><div className="h3">{title}</div><div className="caption muted">{summary()}</div></div>
            </div>
          </div>
        )}
        {!text && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="mono muted">Experimente escrever</span>
            {[['almoço 12,50', 'vira gasto'], ['ligar pra mãe amanhã', 'vira tarefa de amanhã'], ['correr seg qua sex', 'vira hábito']].map(([a, b]) => (
              <button type="button" key={a} className="row between" style={{ padding: '6px 0' }} onClick={() => setText(a)}>
                <span>“{a}”</span><span className="caption muted">{b}</span>
              </button>
            ))}
          </div>
        )}
        <div className="row">
          {kind === 'event' && <button type="button" className="btn secondary grow" onClick={() => { close(); nav('/agenda?novo=1') }}>Mais detalhes</button>}
          <button className="btn primary grow" disabled={!title || busy}>{busy ? 'Salvando…' : `Criar ${KINDS.find(([k]) => k === kind)![1].toLowerCase()}`}</button>
        </div>
      </form>
    </Sheet>
  )
}

function addHour(t: string) { const [h, m] = t.split(':').map(Number); return `${String(Math.min(h + 1, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}` }
