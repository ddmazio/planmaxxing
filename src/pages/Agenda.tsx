import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { addMonths, endOfMonth, startOfMonth } from 'date-fns'
import { insert, remove, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd, hhmm, isSameDay, toIso, todayYmd, weekDays, weekStart, ymd } from '../lib/dates'
import { layoutDay, useCalendars } from '../lib/calendars'
import type { Area, CalEvent } from '../lib/types'
import { Sheet, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'

type View = 'dia' | 'semana' | 'mes'
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const HOUR_PX = 48
type Paint = (e: CalEvent) => { fg: string; bg: string }

export function Agenda() {
  const [sp, setSp] = useSearchParams()
  const { profile } = useAuth()
  const ws = profile?.week_starts_on ?? 1
  const desktop = window.matchMedia('(min-width: 1024px)').matches
  const view = (sp.get('v') as View) || (desktop ? 'semana' : 'dia')
  const date = sp.get('d') ? fromYmd(sp.get('d')!) : new Date()
  const setParam = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v == null) n.delete(k); else n.set(k, v); setSp(n, { replace: true }) }
  const [calsOpen, setCalsOpen] = useState(false)
  const [panel, setPanel] = useState(() => { try { return localStorage.getItem('agenda-panel') !== '0' } catch { return true } })
  const togglePanel = () => { const v = !panel; setPanel(v); try { localStorage.setItem('agenda-panel', v ? '1' : '0') } catch { /* */ } }

  const range = useMemo(() => {
    if (view === 'dia') return [date, addDays(date, 1)]
    if (view === 'semana') { const s = weekStart(date, ws); return [s, addDays(s, 7)] }
    const s = weekStart(startOfMonth(date), ws); return [s, addDays(s, 42)]
  }, [view, date.getTime(), ws]) // eslint-disable-line react-hooks/exhaustive-deps
  const { rows: all } = useRows<CalEvent>('events', { gte: { starts_at: range[0].toISOString() }, lt: { starts_at: range[1].toISOString() }, order: { column: 'starts_at' } })
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const cals = useCalendars(areas)
  const events = all.filter(cals.visible)
  const hiddenCount = cals.list.filter((c) => !c.visible).length

  const editing = sp.get('evento'), creating = sp.get('novo')
  const current = all.find((e) => e.id === editing) ?? null
  const step = (dir: number) => setParam('d', ymd(view === 'mes' ? addMonths(date, dir) : addDays(date, view === 'semana' ? 7 * dir : dir)))

  const title = view === 'mes' ? fmt(date, 'MMMM yyyy') : view === 'semana' ? `${fmt(weekStart(date, ws), 'd MMM')} – ${fmt(addDays(weekStart(date, ws), 6), 'd MMM')}` : fmt(date, "EEEE, d 'de' MMMM")
  const showPanel = desktop && panel && cals.list.length > 1

  return (
    <div className="page wide">
      <header className="row between" style={{ flexWrap: 'wrap', gap: 12 }}>
        <div className="row">
          <h1 className="h1">{title.charAt(0).toUpperCase() + title.slice(1)}</h1>
          <button className="icon-btn" aria-label="Anterior" onClick={() => step(-1)}><Icon name="back" size={16} /></button>
          <button className="icon-btn" aria-label="Próximo" onClick={() => step(1)}><Icon name="chevron" size={16} /></button>
          <button className="btn secondary small" onClick={() => setParam('d', null)}>Hoje</button>
        </div>
        <div className="row" style={{ flexWrap: 'wrap' }}>
          {cals.list.length > 1 && (
            <button className="btn secondary small" aria-pressed={desktop ? panel : calsOpen} onClick={() => (desktop ? togglePanel() : setCalsOpen(true))}>
              <Icon name="list" size={16} />Agendas{hiddenCount ? ` · ${cals.list.length - hiddenCount} de ${cals.list.length}` : ''}
            </button>
          )}
          <div className="seg" role="tablist" aria-label="Visão">
            {(['dia', 'semana', 'mes'] as View[]).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? 'on' : ''} onClick={() => setParam('v', v)}>{v === 'mes' ? 'Mês' : v[0].toUpperCase() + v.slice(1)}</button>)}
          </div>
          <button className="btn primary small" onClick={() => setParam('novo', ymd(date))}><Icon name="plus" size={16} />Novo</button>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: showPanel ? '220px minmax(0, 1fr)' : 'minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
        {showPanel && <div className="card" style={{ padding: 8, position: 'sticky', top: 16 }}><CalendarList cals={cals} /></div>}
        {view === 'mes' ? (
          <Month date={date} ws={ws} events={events} paint={cals.paint} onPick={(d) => { const n = new URLSearchParams(sp); n.set('v', 'dia'); n.set('d', ymd(d)); setSp(n) }} />
        ) : (
          <TimeGrid days={view === 'dia' ? [date] : weekDays(date, ws)} events={events} paint={cals.paint} onOpen={(id) => setParam('evento', id)} onNew={(d) => setParam('novo', ymd(d))} />
        )}
      </div>

      <Sheet open={calsOpen} onClose={() => setCalsOpen(false)} title="Agendas" labelledBy="cals-sheet"><CalendarList cals={cals} /></Sheet>

      <Sheet open={!!(current || creating)} onClose={() => { const n = new URLSearchParams(sp); n.delete('evento'); n.delete('novo'); setSp(n, { replace: true }) }}
        title={current ? 'Compromisso' : 'Novo compromisso'} labelledBy="ev-title">
        {(current || creating) && <EventForm key={current?.id ?? creating} ev={current} day={creating && creating !== '1' ? creating : todayYmd()} areas={areas}
          onDone={() => { const n = new URLSearchParams(sp); n.delete('evento'); n.delete('novo'); setSp(n, { replace: true }) }} />}
      </Sheet>
    </div>
  )
}

function CalendarList({ cals }: { cals: ReturnType<typeof useCalendars> }) {
  const allOn = cals.list.every((c) => c.visible)
  return (
    <div className="stack" style={{ gap: 2 }}>
      {cals.list.map((c) => (
        <label key={c.key} className="row cal-item" style={{ gap: 10, padding: '7px 8px', borderRadius: 10, cursor: 'pointer' }}>
          <input type="checkbox" checked={c.visible} onChange={(e) => cals.toggle(c.key, e.target.checked)} className="cal-check"
            style={{ ['--cal' as string]: c.color ?? 'var(--ink)' }} />
          <span className="grow caption" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={c.name}>{c.name}</span>
        </label>
      ))}
      <button className="caption muted" style={{ textAlign: 'left', padding: '8px 8px 4px' }}
        onClick={() => cals.list.forEach((c) => c.visible !== !allOn && cals.toggle(c.key, !allOn))}>{allOn ? 'Esconder todas' : 'Mostrar todas'}</button>
    </div>
  )
}

function TimeGrid({ days, events, paint, onOpen, onNew }: { days: Date[]; events: CalEvent[]; paint: Paint; onOpen: (id: string) => void; onNew: (d: Date) => void }) {
  const now = new Date()
  const scroller = useRef<HTMLDivElement>(null)
  const [height, setHeight] = useState(480)
  useEffect(() => { if (scroller.current) scroller.current.scrollTop = 7 * HOUR_PX - 8 }, [])
  // a grade ocupa até o fim da janela (no celular, desconta a barra de baixo)
  useLayoutEffect(() => {
    const fit = () => {
      const el = scroller.current
      if (!el) return
      const bottomGap = window.matchMedia('(min-width: 1024px)').matches ? 28 : 112
      setHeight(Math.max(320, Math.round(window.innerHeight - el.getBoundingClientRect().top - bottomGap)))
    }
    fit()
    window.addEventListener('resize', fit)
    const ro = new ResizeObserver(fit); if (scroller.current?.parentElement) ro.observe(scroller.current.parentElement)
    return () => { window.removeEventListener('resize', fit); ro.disconnect() }
  }, [])
  const cols = `36px repeat(${days.length}, minmax(0, 1fr))`
  return (
    <div className="card" style={{ padding: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: cols }}>
        <div />
        {days.map((d) => (
          <button key={d.toISOString()} onClick={() => onNew(d)} className="stack" style={{ alignItems: 'center', gap: 2, paddingBottom: 8 }} aria-label={`Novo em ${fmt(d, 'd MMM')}`}>
            <span className="mono muted">{fmt(d, 'EEEEEE')}</span>
            <span className="medium" style={isSameDay(d, now) ? { background: 'var(--ink)', color: 'var(--on-ink)', borderRadius: '50%', width: 28, height: 28, display: 'grid', placeItems: 'center' } : { height: 28, display: 'grid', placeItems: 'center' }}>{fmt(d, 'd')}</span>
          </button>
        ))}
        <div className="mono faint" style={{ fontSize: 10, paddingTop: 2 }}>dia</div>
        {days.map((d) => (
          <div key={'ad' + d.toISOString()} className="stack" style={{ gap: 2, padding: '0 2px 6px', maxHeight: 112, overflowY: 'auto' }}>
            {events.filter((e) => e.all_day && isSameDay(new Date(e.starts_at), d)).map((e) => {
              const p = paint(e)
              return <button key={e.id} onClick={() => onOpen(e.id)} className="caption" title={e.title} style={{ textAlign: 'left', borderRadius: 6, padding: '2px 6px', background: p.bg, color: 'var(--text-primary)', boxShadow: `inset 3px 0 0 ${p.fg}`, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', flex: 'none' }}>{e.title}</button>
            })}
          </div>
        ))}
      </div>
      <div ref={scroller} style={{ display: 'grid', gridTemplateColumns: cols, height, overflowY: 'auto', borderTop: '1px solid var(--border)' }}>
        <div>{HOURS.map((h) => <div key={h} className="cal-hour">{String(h).padStart(2, '0')}</div>)}</div>
        {days.map((d) => {
          const timed = events.filter((e) => !e.all_day && isSameDay(new Date(e.starts_at), d))
          const lay = layoutDay(timed)
          return (
            <div key={'c' + d.toISOString()} style={{ position: 'relative', borderLeft: '1px solid var(--border)' }}>
              {HOURS.map((h) => <div key={h} className="cal-hour" />)}
              {isSameDay(d, now) && <div style={{ position: 'absolute', left: 0, right: 0, top: (now.getHours() + now.getMinutes() / 60) * HOUR_PX, height: 2, background: 'var(--danger)', zIndex: 2 }} />}
              {timed.map((e) => {
                const s = new Date(e.starts_at), en = new Date(e.ends_at)
                const top = (s.getHours() + s.getMinutes() / 60) * HOUR_PX
                const endH = isSameDay(en, s) ? en.getHours() + en.getMinutes() / 60 : 24
                const h = Math.max(20, (endH - (s.getHours() + s.getMinutes() / 60)) * HOUR_PX - 2)
                const { col, cols: n } = lay.get(e.id) ?? { col: 0, cols: 1 }
                const p = paint(e)
                return (
                  <button key={e.id} onClick={() => onOpen(e.id)} className={'cal-event ' + e.kind} title={`${hhmm(e.starts_at)} ${e.title}`}
                    style={{ top, height: h, left: `calc(${(col * 100) / n}% + 2px)`, width: `calc(${100 / n}% - 4px)`, ...(e.kind === 'plan' ? { background: p.bg, color: 'var(--text-primary)' } : { ['--ev-fg' as string]: p.fg, background: `color-mix(in srgb, ${p.fg} 10%, var(--bg-surface))` }) }}>
                    <div className="medium" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title}</div>
                    {h > 34 && <div style={{ opacity: 0.75 }}>{hhmm(e.starts_at)}</div>}
                  </button>
                )
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Month({ date, ws, events, paint, onPick }: { date: Date; ws: number; events: CalEvent[]; paint: Paint; onPick: (d: Date) => void }) {
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
              <span className="month-evs">
                {evs.slice(0, 3).map((e) => <span key={e.id} className="month-ev" style={{ boxShadow: `inset 2px 0 0 ${paint(e).fg}` }}>{e.title}</span>)}
                {evs.length > 3 && <span className="caption muted">+{evs.length - 3}</span>}
              </span>
              <span className="dots">{evs.slice(0, 6).map((e) => <span key={e.id} className="dot" style={{ background: paint(e).fg }} />)}</span>
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
      {ev?.external_id?.startsWith('gcal:') && <div className="banner caption">Veio do Google Agenda. Se mudar aqui e importar de novo, volta a ficar como está no Google.</div>}
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
