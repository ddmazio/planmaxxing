import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addMonths, endOfMonth, startOfMonth } from 'date-fns'
import { insert, remove, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, hhmm, isSameDay, toIso, todayYmd, weekDays, weekStart, ymd } from '../lib/dates'
import type { Area, CalEvent } from '../lib/types'
import { Sheet, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'

type View = 'dia' | 'semana' | 'mes'
const HOURS = Array.from({ length: 17 }, (_, i) => i + 7) // 07h–23h
const HOUR_PX = 48

export function Agenda() {
  const [sp, setSp] = useSearchParams()
  const { profile } = useAuth()
  const ws = profile?.week_starts_on ?? 1
  const view = (sp.get('v') as View) || (window.matchMedia('(min-width: 1024px)').matches ? 'semana' : 'dia')
  const date = sp.get('d') ? fromYmd(sp.get('d')!) : new Date()
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v == null) n.delete(k); else n.set(k, v); setSp(n, { replace: true }) }

  const range = useMemo(() => {
    if (view === 'dia') return [date, addDays(date, 1)]
    if (view === 'semana') { const s = weekStart(date, ws); return [s, addDays(s, 7)] }
    const s = weekStart(startOfMonth(date), ws); return [s, addDays(s, 42)]
  }, [view, date.getTime(), ws]) // eslint-disable-line react-hooks/exhaustive-deps
  const { rows: events } = useRows<CalEvent>('events', { gte: { starts_at: range[0].toISOString() }, lt: { starts_at: range[1].toISOString() }, order: { column: 'starts_at' } })
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const colorOf = (e: CalEvent) => areas.find((a) => a.id === e.area_id)?.color ?? 'neutro'

  const editing = sp.get('evento'), creating = sp.get('novo')
  const current = events.find((e) => e.id === editing) ?? null
  const step = (dir: number) => setParam('d', ymd(view === 'mes' ? addMonths(date, dir) : addDays(date, view === 'semana' ? 7 * dir : dir)))

  const title = view === 'mes' ? fmt(date, 'MMMM yyyy') : view === 'semana' ? `${fmt(weekStart(date, ws), 'd MMM')} – ${fmt(addDays(weekStart(date, ws), 6), 'd MMM')}` : fmt(date, "EEEE, d 'de' MMMM")

  return (
    <div className="page wide">
      <header className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="row">
          <h1 className="h1">{title.charAt(0).toUpperCase() + title.slice(1)}</h1>
          <button className="icon-btn" aria-label="Anterior" onClick={() => step(-1)}><Icon name="back" size={16} /></button>
          <button className="icon-btn" aria-label="Próximo" onClick={() => step(1)}><Icon name="chevron" size={16} /></button>
          <button className="btn secondary small" onClick={() => setParam('d', null)}>Hoje</button>
        </div>
        <div className="row">
          <div className="seg" role="tablist" aria-label="Visão">
            {(['dia', 'semana', 'mes'] as View[]).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setParam('v', v)}>{v === 'mes' ? 'Mês' : v[0].toUpperCase() + v.slice(1)}</button>)}
          </div>
          <button className="btn primary small" onClick={() => setParam('novo', ymd(date))}><Icon name="plus" size={16} />Novo</button>
        </div>
      </header>

      {view === 'mes' ? (
        <Month date={date} ws={ws} events={events} colorOf={colorOf} onPick={(d) => { const n = new URLSearchParams(sp); n.set('v', 'dia'); n.set('d', ymd(d)); setSp(n) }} />
      ) : (
        <TimeGrid days={view === 'dia' ? [date] : weekDays(date, ws)} events={events} colorOf={colorOf} onOpen={(id) => setParam('evento', id)} onNew={(d) => setParam('novo', ymd(d))} />
      )}

      <Sheet open={!!(current || creating)} onClose={() => { const n = new URLSearchParams(sp); n.delete('evento'); n.delete('novo'); setSp(n, { replace: true }) }}
        title={current ? 'Compromisso' : 'Novo compromisso'} labelledBy="ev-title">
        {(current || creating) && <EventForm key={current?.id ?? creating} ev={current} day={creating && creating !== '1' ? creating : todayYmd()} areas={areas}
          onDone={() => { const n = new URLSearchParams(sp); n.delete('evento'); n.delete('novo'); setSp(n, { replace: true }) }} />}
      </Sheet>
    </div>
  )
}

function TimeGrid({ days, events, colorOf, onOpen, onNew }: { days: Date[]; events: CalEvent[]; colorOf: (e: CalEvent) => string; onOpen: (id: string) => void; onNew: (d: Date) => void }) {
  const now = new Date()
  return (
    <div className="card" style={{ padding: 12, overflowX: 'auto' }}>
      <div style={{ display: 'grid', gridTemplateColumns: `36px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div />
        {days.map((d) => (
          <button key={d.toISOString()} onClick={() => onNew(d)} className="stack" style={{ alignItems: 'center', gap: 2, paddingBottom: 8 }} aria-label={`Novo em ${fmt(d, 'd MMM')}`}>
            <span className="mono muted">{fmt(d, 'EEEEEE')}</span>
            <span className="medium" style={isSameDay(d, now) ? { background: 'var(--ink)', color: 'var(--on-ink)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center' } : { height: 28, display: 'grid', placeItems: 'center' }}>{fmt(d, 'd')}</span>
          </button>
        ))}
        {/* eventos de dia inteiro */}
        <div className="mono faint" style={{ fontSize: 10, paddingTop: 2 }}>dia</div>
        {days.map((d) => (
          <div key={'ad' + d.toISOString()} className="stack" style={{ gap: 2, padding: '0 2px 6px' }}>
            {events.filter((e) => e.all_day && isSameDay(new Date(e.starts_at), d)).map((e) => (
              <button key={e.id} onClick={() => onOpen(e.id)} className="caption" style={{ textAlign: 'left', borderRadius: 6, padding: '2px 6px', background: `var(--${colorOf(e)}-bg)`, color: `var(--${colorOf(e)}-fg)`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{e.title}</button>
            ))}
          </div>
        ))}
        <div>{HOURS.map((h) => <div key={h} className="cal-hour">{String(h).padStart(2, '0')}</div>)}</div>
        {days.map((d) => (
          <div key={'c' + d.toISOString()} style={{ position: 'relative', borderLeft: '1px solid var(--border)' }}>
            {HOURS.map((h) => <div key={h} className="cal-hour" />)}
            {isSameDay(d, now) && now.getHours() >= 7 && <div style={{ position: 'absolute', left: 0, right: 0, top: (now.getHours() - 7 + now.getMinutes() / 60) * HOUR_PX, height: 2, background: 'var(--ink)' }} />}
            {events.filter((e) => !e.all_day && isSameDay(new Date(e.starts_at), d)).map((e) => {
              const s = new Date(e.starts_at), en = new Date(e.ends_at)
              const top = Math.max(0, (s.getHours() - 7 + s.getMinutes() / 60) * HOUR_PX)
              const h = Math.max(22, ((en.getTime() - s.getTime()) / 36e5) * HOUR_PX - 2)
              const c = colorOf(e)
              return (
                <button key={e.id} onClick={() => onOpen(e.id)} className={'cal-event ' + e.kind}
                  style={{ top, height: h, left: 2, right: 2, ...(e.kind === 'plan' ? { background: `var(--${c}-bg)`, color: `var(--${c}-fg)` } : { ['--ev-fg' as string]: `var(--${c}-fg)` }) }}>
                  <div className="medium" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                  {h > 34 && <div style={{ opacity: 0.8 }}>{hhmm(e.starts_at)}</div>}
                </button>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

function Month({ date, ws, events, colorOf, onPick }: { date: Date; ws: number; events: CalEvent[]; colorOf: (e: CalEvent) => string; onPick: (d: Date) => void }) {
  const start = weekStart(startOfMonth(date), ws)
  const end = endOfMonth(date)
  const days = Array.from({ length: 42 }, (_, i) => addDays(start, i))
  const wkNames = weekDays(date, ws).map((d) => fmt(d, 'EEEEEE'))
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="month">{wkNames.map((n) => <span key={n} className="mono muted" style={{ textAlign: 'center' }}>{n}</span>)}</div>
      <div className="month">
        {days.map((d) => {
          const evs = events.filter((e) => isSameDay(new Date(e.starts_at), d))
          const out = d.getMonth() !== date.getMonth() || d > end
          return (
            <button key={d.toISOString()} className={'day' + (out ? ' out' : '') + (isSameDay(d, new Date()) ? ' today' : '')} onClick={() => onPick(d)} aria-label={`${fmt(d, "d 'de' MMMM")}, ${evs.length} eventos`}>
              <span className="num caption medium">{fmt(d, 'd')}</span>
              <span className="dots">{evs.slice(0, 6).map((e) => <span key={e.id} className="dot" style={{ background: `var(--${colorOf(e)}-fg)` }} />)}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function EventForm({ ev, day, areas, onDone }: { ev: CalEvent | null; day: string; areas: Area[]; onDone: () => void }) {
  const start = ev ? new Date(ev.starts_at) : null, end = ev ? new Date(ev.ends_at) : null
  const [f, setF] = useState({
    title: ev?.title ?? '', date: start ? ymd(start) : day, from: start ? hhmm(ev!.starts_at) : '09:00', to: end ? hhmm(ev!.ends_at) : '10:00',
    all_day: ev?.all_day ?? false, kind: ev?.kind ?? 'appointment', area_id: ev?.area_id ?? '', location: ev?.location ?? '', notes: ev?.notes ?? '',
    reminder: ev?.reminder_minutes ?? 30,
  })
  const [err, setErr] = useState<string | null>(null)
  const save = async () => {
    if (!f.title.trim()) return setErr('Dê um nome ao compromisso.')
    const s = toIso(f.date, f.all_day ? '00:00' : f.from), e = toIso(f.date, f.all_day ? '23:59' : f.to)
    if (e < s) return setErr('O fim precisa ser depois do início.')
    const row: Partial<CalEvent> = { title: f.title.trim(), starts_at: s, ends_at: e, all_day: f.all_day, kind: f.kind as CalEvent['kind'], area_id: f.area_id || null, location: f.location || null, notes: f.notes || null, reminder_minutes: f.reminder }
    if (ev) await update<CalEvent>('events', ev.id, row); else await insert<CalEvent>('events', row)
    onDone()
  }
  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); save() }}>
      <input id="ev-title" className="input" style={{ fontSize: 20 }} autoFocus placeholder="Consulta médica" value={f.title} maxLength={200} onChange={(e) => setF({ ...f, title: e.target.value })} aria-label="Título" />
      <div className="seg">{([['appointment', 'Compromisso'], ['plan', 'Bloco do plano']] as const).map(([k, l]) => <button type="button" key={k} className={f.kind === k ? 'on' : ''} onClick={() => setF({ ...f, kind: k })}>{l}</button>)}</div>
      <div className="row"><label className="field grow"><span>Data</span><input type="date" required className="input" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></label></div>
      <div className="row"><span className="grow">Dia inteiro</span><Toggle label="Dia inteiro" on={f.all_day} onChange={(v) => setF({ ...f, all_day: v })} /></div>
      {!f.all_day && <div className="row">
        <label className="field grow"><span>Início</span><input type="time" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="field grow"><span>Fim</span><input type="time" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
      </div>}
      <label className="field"><span>Área</span><select className="input" value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value })}><option value="">Nenhuma</option>{areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      <label className="field"><span>Local</span><input className="input" value={f.location} maxLength={200} onChange={(e) => setF({ ...f, location: e.target.value })} /></label>
      <label className="field"><span>Lembrete</span><select className="input" value={f.reminder} onChange={(e) => setF({ ...f, reminder: Number(e.target.value) })}>
        {[[0, 'Na hora'], [10, '10 min antes'], [30, '30 min antes'], [60, '1 hora antes'], [1440, '1 dia antes']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="field"><span>Notas</span><textarea className="input" value={f.notes} maxLength={5000} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
      {err && <p role="alert" className="caption" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}
      <div className="row">
        {ev && <button type="button" className="btn danger" onClick={async () => { if (confirm('Apagar este compromisso?')) { await remove('events', ev.id); onDone() } }}>Apagar</button>}
        <button className="btn primary grow">{ev ? 'Salvar' : 'Criar compromisso'}</button>
      </div>
    </form>
  )
}
