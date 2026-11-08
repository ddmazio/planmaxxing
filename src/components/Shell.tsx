import { useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { useRows, useToast } from '../lib/hooks'
import type { Area } from '../lib/types'
import { Icon } from './Icon'
import { QuickAdd } from './QuickAdd'
import { Toast } from './ui'

const MAIN: [string, string, string][] = [
  ['/', 'Hoje', 'home'], ['/agenda', 'Agenda', 'calendar'], ['/tarefas', 'Tarefas', 'check'], ['/financas', 'Finanças', 'wallet'], ['/ciclo', 'Ciclo', 'target'],
]

export function Shell() {
  const [quick, setQuick] = useState(false)
  const toast = useToast()
  const { demo, profile } = useAuth()
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const loc = useLocation()
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to))

  return (
    <div className="app">
      <aside className="sidebar" aria-label="Navegação">
        <div className="brand"><span className="brand-mark">db</span>Dream Board</div>
        {MAIN.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={() => 'nav-item' + (isActive(to) ? ' active' : '')}><Icon name={icon} />{label}</NavLink>
        ))}
        <button className="nav-item" onClick={() => setQuick(true)}><Icon name="plus" />Novo</button>
        <div className="nav-section mono faint">Áreas da vida</div>
        {areas.map((a) => (
          <NavLink key={a.id} to={a.is_fixed ? '/financas' : `/ciclo/area/${a.id}`} className="nav-item" style={{ paddingTop: 8, paddingBottom: 8 }}>
            <span className="dot" style={{ background: `var(--${a.color}-fg)`, width: 10, height: 10 }} />{a.name}
          </NavLink>
        ))}
        <div className="grow" />
        <NavLink to="/config" className={() => 'nav-item' + (isActive('/config') ? ' active' : '')}>
          <Icon name="settings" /><span className="grow">{profile?.display_name || 'Configurações'}</span>
        </NavLink>
      </aside>

      <main className="main">
        {demo && <div className="banner" style={{ maxWidth: 1224, margin: '0 auto 12px' }}>Modo demonstração: os dados ficam só neste aparelho. Ligue o Supabase para sincronizar e partilhar.</div>}
        <Outlet context={{ openQuick: () => setQuick(true), toast: toast.show }} />
      </main>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {MAIN.map(([to, label, icon]) => (
          <NavLink key={to} to={to} aria-label={label} className={() => (isActive(to) ? 'active' : '')}><Icon name={icon} size={22} /></NavLink>
        ))}
        <button className="plus" aria-label="Novo" onClick={() => setQuick(true)}><Icon name="plus" size={22} /></button>
      </nav>

      <QuickAdd open={quick} onClose={() => setQuick(false)} onDone={toast.show} />
      <Toast msg={toast.msg} />
    </div>
  )
}

export interface ShellCtx { openQuick: () => void; toast: (m: string) => void }

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
