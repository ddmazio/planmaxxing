import { Logo } from './Logo'
import { useApp } from '../lib/app'
import { useIsAdmin } from '../pages/Admin'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { QuickKind } from '../lib/parse'
import type { UndoMsg } from '../lib/undo'
import { useAuth } from '../lib/auth'
import { useRows, useToast } from '../lib/hooks'
import type { Area, Cycle } from '../lib/types'
import { currentCycle, weekOf, execWeeks, totalWeeks } from '../lib/cycle'
import { Icon } from './Icon'
import { QuickAdd } from './QuickAdd'
import { GOTO, Search } from './Search'
import { AreaIcon, Toast } from './ui'
import { shownAreas } from '../lib/areas'

/** menu de baixo no celular: o + fica no meio; Hoje mora no botão Início do topo */
const MAIN_LEFT: [string, string, string][] = [['/agenda', 'Agenda', 'calendar'], ['/tarefas', 'Tarefas', 'check']]
const MAIN_RIGHT: [string, string, string][] = [['/financas', 'Finanças', 'wallet'], ['/ciclo', 'Ciclo', 'target']]
const SIDE: [string, string, string][] = [
  ['/', 'Hoje', 'home'], ['/agenda', 'Agenda', 'calendar'], ['/tarefas', 'Tarefas', 'check'], ['/financas', 'Finanças', 'wallet'],
  ['/ciclo', 'Plano do ciclo', 'target'], ['/reflexoes', 'Reflexões', 'book'], ['/grupo', 'Grupo', 'users'],
]

export function Shell() {
  const [quick, setQuick] = useState(false)
  // menu lateral recolhível no computador (o app lembra a escolha)
  const [rail, setRail] = useState(() => { try { return localStorage.getItem('tf-rail') === '1' } catch { return false } })
  const toggleRail = () => setRail((r) => { try { localStorage.setItem('tf-rail', r ? '0' : '1') } catch { /* */ } return !r })
  const [search, setSearch] = useState(false)
  const toast = useToast()
  const { demo, profile } = useAuth()
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const { rows: cycles } = useRows<Cycle>('cycles')
  const cycle = currentCycle(cycles)
  const week = cycle ? weekOf(cycle) : 0
  const EW = execWeeks(cycle), TW = totalWeeks(cycle)
  const loc = useLocation()
  const cicloZone = ['/ciclo', '/reflexoes', '/grupo', '/convite', '/habito', '/semana', '/trimestre'].some((p) => loc.pathname.startsWith(p))
  // no ritual de novo ciclo o “+ Novo” sai da tela: o foco é planejar, não lançar coisas soltas
  const inRitual = loc.pathname.startsWith('/ciclo/trimestre')
  const isTab = (to: string) => (to === '/ciclo' ? cicloZone : loc.pathname.startsWith(to))
  const isActive = (to: string) => (to === '/' ? loc.pathname === '/' : to === '/ciclo' ? loc.pathname.startsWith('/ciclo') && !loc.pathname.startsWith('/ciclo/area') : to === '/grupo' ? loc.pathname.startsWith('/grupo') || loc.pathname.startsWith('/convite') : loc.pathname.startsWith(to))

  const nav = useNavigate()
  const [quickKind, setQuickKind] = useState<QuickKind | null>(null)
  const openNew = (k: QuickKind | null = null) => { setQuickKind(k); setQuick(true) }
  // ⌘K abre a paleta; N cria; G e depois uma letra vai para a página (fora de campos de texto)
  const gAt = useRef(0)
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch((v) => !v); return }
      const el = e.target as HTMLElement | null
      if (e.metaKey || e.ctrlKey || e.altKey || (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) || document.querySelector('[aria-modal="true"]')) return
      const k = e.key.toLowerCase()
      if (Date.now() - gAt.current < 1200) { gAt.current = 0; const hit = GOTO.find(([key]) => key === k); if (hit) { e.preventDefault(); nav(hit[2]) } return }
      if (k === 'g') { gAt.current = Date.now(); return }
      if (k === 'n' && !window.location.pathname.startsWith('/ciclo/trimestre')) { e.preventDefault(); openNew('task') }
    }
    window.addEventListener('keydown', on)
    return () => window.removeEventListener('keydown', on)
  }, [nav])
  // aviso com Desfazer
  const [undo, setUndo] = useState<UndoMsg | null>(null)
  useEffect(() => { const on = (e: Event) => setUndo((e as CustomEvent<UndoMsg>).detail); window.addEventListener('tf-undo', on); return () => window.removeEventListener('tf-undo', on) }, [])
  useEffect(() => { if (!undo) return; const t = setTimeout(() => setUndo((u) => (u?.id === undo.id ? null : u)), 4000); return () => clearTimeout(t) }, [undo])
  const name = profile?.display_name || 'Você'
  // painel do app: aviso para todos, pedido de atualização e modo manutenção
  const { settings: app } = useApp()
  const owner = useIsAdmin()
  const today = new Date().toISOString().slice(0, 10)
  const noticeKey = app.announcement_at ?? ''
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem('tf-aviso') ?? '' } catch { return '' } })
  const notice = app.announcement && (!app.announcement_until || app.announcement_until >= today) && hidden !== noticeKey ? app.announcement : null
  const hideNotice = () => { setHidden(noticeKey); try { localStorage.setItem('tf-aviso', noticeKey) } catch { /* */ } }
  const stale = !!app.refresh_after && app.refresh_after > __BUILD__
  const [offline, setOffline] = useState(typeof navigator !== 'undefined' && !navigator.onLine)
  useEffect(() => {
    const on = () => setOffline(!navigator.onLine)
    window.addEventListener('online', on); window.addEventListener('offline', on)
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', on) }
  }, [])

  return (
    app.maintenance && !owner ? (
      <div className="maintenance">
        <Logo size={56} />
        <h1 className="serif" style={{ fontSize: 36, lineHeight: '40px', margin: 0 }}>Uma pausa rápida.</h1>
        <p className="muted" style={{ margin: 0, maxWidth: 360 }}>O Twelvefold está passando por uma arrumação. Seus dados estão guardados. Volte daqui a pouco.</p>
        <button className="btn secondary" onClick={() => window.location.reload()}>Tentar de novo</button>
      </div>
    ) :
    <div className={'app' + (rail ? ' rail' : '')}>
      <aside className="sidebar" aria-label="Navegação">
        <div className="brand">
          <Logo size={40} />
          <span className="grow brand-text">Twelvefold<span className="brand-sub">{!cycle ? 'Sem ciclo em curso' : week === 0 ? `${cycle.name} · começa em breve` : week > TW ? `${cycle.name} · terminou` : week > EW ? `${cycle.name} · semana de revisão` : `${cycle.name} · semana ${week} de ${EW}`}</span></span>
          <button className="rail-toggle" onClick={toggleRail} aria-label={rail ? 'Abrir o menu' : 'Recolher o menu'} aria-expanded={!rail} title={rail ? 'Abrir o menu' : 'Recolher o menu'}><Icon name="panel" size={20} /></button>
        </div>
        <button className="side-search" onClick={() => setSearch(true)} title="Buscar (⌘K)"><Icon name="search" size={16} /><span className="grow">Buscar</span><span className="kbd">⌘K</span></button>
        <div className="side-scroll">
        <div className="nav-section mono faint">Principal</div>
        {SIDE.map(([to, label, icon]) => (
          <NavLink key={to} to={to} title={label} className={() => 'nav-item' + (isActive(to) ? ' active' : '')}><Icon name={icon} /><span className="nav-label">{label}</span></NavLink>
        ))}
        <div className="nav-section mono faint">Áreas da vida</div>
        {shownAreas(areas).map((a) => (
          <NavLink key={a.id} to={a.is_fixed ? '/financas' : `/ciclo/area/${a.id}`} title={a.name} className={() => 'nav-item' + (loc.pathname === `/ciclo/area/${a.id}` ? ' active' : '')} style={{ paddingTop: 6, paddingBottom: 6 }}>
            <AreaIcon area={a} size={26} /><span className="nav-label">{a.name}</span>
          </NavLink>
        ))}
        <NavLink to="/config/areas" title="Editar áreas" className="nav-item faint" style={{ paddingTop: 8, paddingBottom: 8 }}><Icon name="plus" size={16} /><span className="nav-label">Editar áreas</span></NavLink>
        </div>
        <NavLink to="/config" className={() => 'nav-item side-user' + (isActive('/config') ? ' active' : '')} aria-label="Configurações">
          <span className="avatar">{name.charAt(0).toUpperCase()}</span>
          <span className="grow stack" style={{ gap: 0 }}>
            <span className="medium" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
            <span className="caption muted">{!cycle ? 'Sem ciclo em curso' : week === 0 ? `${cycle.name} · começa em breve` : week > TW ? `${cycle.name} · terminou` : `${cycle.name} · semana ${week}`}</span>
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
          {!inRitual && <button className="btn primary new-btn desktop-only" onClick={() => openNew()}><Icon name="plus" size={16} />Novo</button>}
        </div>
        {notice && <div className="notice-bar" role="status"><Icon name="bell" size={14} /><span className="grow">{notice}</span><button className="notice-x" onClick={hideNotice} aria-label="Fechar aviso"><Icon name="x" size={14} /></button></div>}
        {stale && <div className="notice-bar" role="status"><Icon name="repeat" size={14} /><span className="grow">Tem uma versão nova do app.</span><button className="btn small" onClick={() => window.location.reload()}>Atualizar</button></div>}
        {app.maintenance && owner && <div className="notice-bar" role="status"><Icon name="lock" size={14} /><span className="grow">Modo manutenção ligado: as outras pessoas veem uma tela de pausa.</span></div>}
        {offline && <div className="offline-bar" role="status"><Icon name="repeat" size={14} />Sem conexão. O que já está na tela continua aqui; mudanças feitas agora podem não ser guardadas até a internet voltar.</div>}
        {demo && <div className="banner" style={{ maxWidth: 1224, margin: '0 auto 12px' }}>Modo demonstração: os dados ficam só neste aparelho. Ligue o Supabase para sincronizar e partilhar.</div>}
        <Outlet context={{ openQuick: () => openNew(), openSearch: () => setSearch(true), toast: toast.show }} />
      </main>

      <nav className="bottom-nav" aria-label="Navegação principal">
        {MAIN_LEFT.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={() => (isTab(to) ? 'active' : '')}><Icon name={icon} size={22} /><span>{label}</span></NavLink>
        ))}
        {inRitual ? <span className="plus-gap" aria-hidden /> : <button className="plus" aria-label="Novo" onClick={() => openNew()}><Icon name="plus" size={24} /></button>}
        {MAIN_RIGHT.map(([to, label, icon]) => (
          <NavLink key={to} to={to} className={() => (isTab(to) ? 'active' : '')}><Icon name={icon} size={22} /><span>{label}</span></NavLink>
        ))}
      </nav>

      <Search open={search} onClose={() => setSearch(false)} onNew={(k) => openNew(k)} />
      <QuickAdd open={quick} onClose={() => setQuick(false)} onDone={toast.show} initialKind={quickKind} />
      {undo ? (
        <div className="toast undo-toast" role="status">
          <span className="grow">{undo.msg}</span>
          <button className="undo-btn" onClick={() => { const u = undo; setUndo(null); u.undo() }}>Desfazer</button>
        </div>
      ) : <Toast msg={toast.msg} />}
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
