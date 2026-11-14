import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useRows } from '../lib/hooks'
import { addDays, fmt, toIso, todayYmd, ymd } from '../lib/dates'
import type { Area, CalEvent, Goal, List, Step, Task } from '../lib/types'
import { Icon } from './Icon'

const PAGES: [string, string][] = [
  ['Hoje', '/'], ['Agenda', '/agenda'], ['Tarefas', '/tarefas'], ['Finanças', '/financas'], ['Plano do ciclo', '/ciclo'],
  ['Ritual da semana', '/ciclo/ritual'], ['Reflexões', '/reflexoes'], ['Grupo', '/grupo'], ['Configurações', '/config'],
]

const norm = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()

interface Hit { kind: string; title: string; sub?: string; to: string }

/** Busca geral (⌘K): tarefas, metas, passos, agenda, listas, áreas e páginas. */
export function Search({ open, onClose }: { open: boolean; onClose: () => void }) {
  return open ? <Palette onClose={onClose} /> : null
}

function Palette({ onClose }: { onClose: () => void }) {
  const nav = useNavigate()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const now = new Date()
  const { rows: tasks } = useRows<Task>('tasks')
  const { rows: goals } = useRows<Goal>('goals')
  const { rows: steps } = useRows<Step>('steps')
  const { rows: lists } = useRows<List>('lists')
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false } })
  const { rows: events } = useRows<CalEvent>('events', { gte: { starts_at: toIso(ymd(addDays(now, -90))) }, lt: { starts_at: toIso(ymd(addDays(now, 180))) }, order: { column: 'starts_at' } })

  useEffect(() => { input.current?.focus() }, [])

  const hits = useMemo<Hit[]>(() => {
    const t = norm(q.trim())
    if (!t) return PAGES.map(([title, to]) => ({ kind: 'Página', title, to }))
    const m = (s: string | null | undefined) => !!s && norm(s).includes(t)
    const today = todayYmd()
    const out: Hit[] = [
      ...PAGES.filter(([title]) => m(title)).map(([title, to]) => ({ kind: 'Página', title, to })),
      ...tasks.filter((x) => m(x.title) || m(x.notes)).sort((a, b) => Number(!!a.completed_at) - Number(!!b.completed_at))
        .map((x) => ({ kind: x.completed_at ? 'Tarefa feita' : 'Tarefa', title: x.title, sub: lists.find((l) => l.id === x.list_id)?.name, to: `/tarefa/${x.id}` })),
      ...goals.filter((x) => m(x.title) || m(x.done_definition)).map((x) => ({ kind: 'Meta', title: x.title, sub: x.done_definition ?? undefined, to: '/ciclo' })),
      ...steps.filter((x) => m(x.title)).map((x) => ({ kind: 'Passo', title: x.title, sub: `semana ${x.week} · ${goals.find((g) => g.id === x.goal_id)?.title ?? ''}`, to: '/ciclo' })),
      ...events.filter((x) => m(x.title)).sort((a, b) => Number(a.starts_at < today) - Number(b.starts_at < today))
        .map((x) => ({ kind: 'Agenda', title: x.title, sub: fmt(new Date(x.starts_at), x.all_day ? 'EEE, d MMM' : "EEE, d MMM 'às' HH:mm"), to: `/agenda?evento=${x.id}` })),
      ...lists.filter((x) => m(x.name)).map((x) => ({ kind: 'Lista', title: x.name, to: `/tarefas/${x.id}` })),
      ...areas.filter((x) => m(x.name)).map((x) => ({ kind: 'Área', title: x.name, to: x.is_fixed ? '/financas' : `/ciclo/area/${x.id}` })),
    ]
    return out.slice(0, 40)
  }, [q, tasks, goals, steps, lists, areas, events])

  const go = (h?: Hit) => { if (!h) return; onClose(); nav(h.to) }

  return (
    <div className="overlay search-overlay" onClick={onClose}>
      <div className="search" role="dialog" aria-modal="true" aria-label="Buscar" onClick={(e) => e.stopPropagation()}>
        <div className="row search-input">
          <Icon name="search" size={18} className="muted" />
          <input ref={input} className="input bare grow" placeholder="Buscar tarefas, metas, passos, agenda…" value={q}
            onChange={(e) => { setQ(e.target.value); setSel(0) }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') { e.preventDefault(); setSel((s) => Math.min(s + 1, hits.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); go(hits[sel]) }
            }} aria-label="Buscar" role="combobox" aria-expanded aria-controls="search-results" />
          <span className="kbd">esc</span>
        </div>
        <div id="search-results" role="listbox" className="search-results">
          {hits.length ? hits.map((h, i) => (
            <button key={h.kind + h.to + h.title + i} role="option" aria-selected={i === sel} className={'search-hit' + (i === sel ? ' on' : '')}
              onMouseEnter={() => setSel(i)} onClick={() => go(h)}>
              <span className="mono faint" style={{ width: 84, flex: 'none' }}>{h.kind}</span>
              <span className="grow stack" style={{ gap: 0 }}>
                <span>{h.title}</span>
                {h.sub && <span className="caption muted">{h.sub}</span>}
              </span>
            </button>
          )) : <p className="caption muted" style={{ padding: 16, margin: 0 }}>Nada encontrado para “{q}”.</p>}
        </div>
      </div>
    </div>
  )
}
