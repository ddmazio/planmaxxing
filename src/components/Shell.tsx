import { Logo } from './Logo'
import { useEffect, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useRows, useToast } from '../lib/hooks'
import type { Area, Cycle } from '../lib/types'
import { currentCycle, weekOf, TOTAL_WEEKS } from '../lib/cycle'
import { Icon } from './Icon'
import { QuickAdd } from './QuickAdd'
import { Search } from './Search'
import { AreaIcon, Toast } from './ui'

/** menu de baixo no celular: o + fica no meio; Hoje mora no botão Início do topo */
const MAIN_LEFT: [string, string, string][] = [['/agenda', 'Agenda', 'calendar'], ['/tarefas', 'Tarefas', 'check']]
const MAIN_RIGHT: [string, string, string][] = [['/financas', 'Finanças', 'wallet'], ['/ciclo', 'Ciclo', 'target']]
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
  const cicloZone = ['/ciclo', '/reflexoes', '/grupo', '/convite', '/habito', '/semana', '/trimestre'].some((p) => loc.pathname.startsWith(p))
  const isTab = (to: string) => (to === '/ciclo' ? cicloZone : loc.pathname.startsWith(to))
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : to === '/ciclo' ? loc.pathname.startsWith('/ciclo') && !loc.pathname.startsWith('/ciclo/area') : to === '/grupo' ? loc.pathname.startsWith('/grupo') || loc.pathname.startsWith('/convite') : loc.pathname.startsWith(to))

  // ⌘K / Ctrl+K abre a busca em qualquer página
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch((v) => !v) } }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [])
  const name = profile?.display_name || 'Você'
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)
  useEffect(() => {
    const on = () => setOffline(!navigator.onLine)
    window.addEventListener('online', on); window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navegação">
        <div className="brand"><Logo />Twelvefold</div>
        <button className="side-search" onClick={() => setSearch(true)}><Icon name="search" size={16} /><span className="grow">Buscar</span><span className="kbd">⌘K</span></button>
        <div className="side-scroll">
        <div className="nav-section mono faint">Principal</div>
        {SIDE.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={() => 'nav-item' + (isActive(to) ? ' active' : '')}><Icon name={icon} />{label}</NavLink>
        ))}
        <div className="nav-section mono faint">Áreas da vida</div>
        {areas.map((a) => (
          <NavLink key={a.id} to={a.is_fixed ? '/financas' : `/ciclo/area/${a.id}`} className={() => 'nav-item' + (loc.pathname === `/ciclo/area/${a.id}` ? ' active' : '')} style={{ paddingTop: 6, paddingBottom: 6 }}>
            <AreaIcon area={a} size={26} />{a.name}
          </NavLink>
        ))}
        <NavLink to="/config/areas" className="nav-item faint" style={{ paddingTop: 8, paddingBottom: 8 }}><Icon name="plus" size={16} />Editar áreas</NavLink>
        </div>
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
        <div className="topbar">
          <Link to="/config" className="topbar-me mobile-only" aria-label="Perfil e configurações">{name.charAt(0).toUpperCase()}</Link>
          <span className="grow" />
          <NavLink to="/" end className={({ isActive: on }) => 'icon-btn mobile-only' + (on ? ' ink' : '')} aria-label="Início"><Icon name="home" size={19} /></NavLink>
          <button className="icon-btn mobile-only" aria-label="Buscar" onClick={() => setSearch(true)}><Icon name="search" size={19} /></button>
          <button className="btn primary new-btn desktop-only" onClick={() => setQuick(true)}><Icon name="plus" size={16} />Novo</button>
        </div>
        {offline && <div className="offline-bar" role="status"><Icon name="repeat" size={14} />Sem conexão. O que já está na tela continua aqui; mudanças feitas agora podem não ser guardadas até a internet voltar.</div>}
        {demo && <div className="banner" style={{ maxWidth: 1224, margin: '0 auto 12px' }}>Modo demonstração: os dados ficam só neste aparelho. Ligue o Supabase para sincronizar e partilhar.</div>}
        <Outlet context={{ openQuick: () => setQuick(true), openSearch: () => setSearch(true), toast: toast.show }} />
      </main>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {MAIN_LEFT.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={() => (isTab(to) ? 'active' : '')}><Icon name={icon} size={22} /><span>{label}</span></NavLink>
        ))}
        <button className="plus" aria-label="Novo" onClick={() => setQuick(true)}><Icon name="plus" size={24} /></button>
        {MAIN_RIGHT.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={() => (isTab(to) ? 'active' : '')}><Icon name={icon} size={22} /><span>{label}</span></NavLink>
        ))}
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
