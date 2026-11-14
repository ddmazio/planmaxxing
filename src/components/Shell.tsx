import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useRows, useToast } from '../lib/hooks'
import type { Area, Cycle } from '../lib/types'
import { currentCycle, weekOf, TOTAL_WEEKS } from '../lib/cycle'
import { Icon } from './Icon'
import { QuickAdd } from './QuickAdd'
import { Search } from './Search'
import { Toast } from './ui'

const MAIN: [string, string, string][] = [
  ['/', 'Hoje', 'home'], ['/agenda', 'Agenda', 'calendar'], ['/tarefas', 'Tarefas', 'check'], ['/financas', 'Finanças', 'wallet'], ['/ciclo', 'Ciclo', 'target'],
]
const SIDE: [string, string, string][] = [
  ['/', 'Hoje', 'home'], ['/agenda', 'Agenda', 'calendar'], ['/tarefas', 'Tarefas', 'check'], ['/financas', 'Finanças', 'wallet'],
  ['/ciclo', 'Plano do ciclo', 'target'], ['/reflexoes', 'Reflexões', 'book'], ['/grupo', 'Grupo', 'users'],
]

export function Shell() {
  const [quick, setQuick] = useState(false)
  const [search, setSearch] = useState(false)
  const toast = useToast()
  const { demo, profile } = useAuth()
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const { rows: cycles } = useRows<Cycle>('cycles')
  const cycle = currentCycle(cycles)
  const week = cycle ? weekOf(cycle) : 0
  const loc = useLocation()
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : to === '/ciclo' ? loc.pathname.startsWith('/ciclo') && !loc.pathname.startsWith('/ciclo/area') : to === '/grupo' ? loc.pathname.startsWith('/grupo') || loc.pathname.startsWith('/convite') : loc.pathname.startsWith(to))

  // ⌘K / Ctrl+K abre a busca em qualquer página
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch((v) => !v) } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const name = profile?.display_name || 'Você'

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navegação">
        <div className="brand"><span className="brand-mark">db</span>Dream Board</div>
        {SIDE.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={() => 'nav-item' + (isActive(to) ? ' active' : '')}><Icon name={icon} />{label}</NavLink>
        ))}
        <button className="nav-item" onClick={() => setQuick(true)}><Icon name="plus" />Novo</button>
        <div className="nav-section mono faint">Áreas da vida</div>
        {areas.map((a) => (
          <NavLink key={a.id} to={a.is_fixed ? '/financas' : `/ciclo/area/${a.id}`} className={() => 'nav-item' + (loc.pathname === `/ciclo/area/${a.id}` ? ' active' : '')} style={{ paddingTop: 8, paddingBottom: 8 }}>
            <span className="dot" style={{ background: `var(--${a.color}-fg)`, width: 10, height: 10 }} />{a.name}
          </NavLink>
        ))}
        <NavLink to="/config#areas" className="nav-item faint" style={{ paddingTop: 8, paddingBottom: 8 }}><Icon name="plus" size={16} />Editar áreas</NavLink>
        <div className="grow" />
        <NavLink to="/config" className={() => 'nav-item side-user' + (isActive('/config') ? ' active' : '')} aria-label="Configurações">
          <span className="avatar">{name.charAt(0).toUpperCase()}</span>
          <span className="grow stack" style={{ gap: 0 }}>
            <span className="medium" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            <span className="caption muted">{!cycle ? 'Sem ciclo em curso' : week === 0 ? `${cycle.name} · começa em breve` : week > TOTAL_WEEKS ? `${cycle.name} · terminou` : `${cycle.name} · semana ${week}`}</span>
          </span>
          <Icon name="settings" size={16} className="faint" />
        </NavLink>
      </aside>

      <main className="main">
        {demo && <div className="banner" style={{ maxWidth: 1224, margin: '0 auto 12px' }}>Modo demonstração: os dados ficam só neste aparelho. Ligue o Supabase para sincronizar e partilhar.</div>}
        <Outlet context={{ openQuick: () => setQuick(true), openSearch: () => setSearch(true), toast: toast.show }} />
      </main>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {MAIN.map(([to, label, icon]) => (
          <NavLink key={to} to={to} aria-label={label} className={() => (isActive(to) ? 'active' : '')}><Icon name={icon} size={22} /></NavLink>
        ))}
        <button className="plus" aria-label="Novo" onClick={() => setQuick(true)}><Icon name="plus" size={22} /></button>
      </nav>

      <Search open={search} onClose={() => setSearch(false)} />
      <QuickAdd open={quick} onClose={() => setQuick(false)} onDone={toast.show} />
      <Toast msg={toast.msg} />
    </div>
  )
}

export interface ShellCtx { openQuick: () => void; openSearch: () => void; toast: (m: string) => void }

export function PageHeader({ eyebrow, title, right }: { eyebrow?: string; title: ReactNode; right?: ReactNode }) {
  return (
    <header className="row between" style={{ alignItems: 'flex-end', flexWrap: 'wrap', rowGap: 12 }}>
      <div className="stack" style={{ gap: 2 }}>
        {eyebrow && <span className="mono muted">{eyebrow}</span>}
        <h1 className="h1">{title}</h1>
      </div>
      {right}
    </header>
  )
}
