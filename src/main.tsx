import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import '@fontsource/geist/400.css'
import '@fontsource/geist/500.css'
import '@fontsource/geist-mono/400.css'
import '@fontsource/instrument-serif/400.css'
import './styles/tokens.css'
import './styles/base.css'
import { AuthProvider, useAuth } from './lib/auth'
import { Shell } from './components/Shell'
import { Login } from './pages/Login'
import { Onboarding } from './pages/Onboarding'
import { Hoje } from './pages/Hoje'
import { Tarefas, TarefaRoute } from './pages/Tarefas'
import { Agenda } from './pages/Agenda'
import { Config, applyTheme, savedTheme } from './pages/Config'
import { Financas } from './pages/Financas'
import { AceitarConvite, Grupo } from './pages/Grupo'
import { AreaPage, Ciclo, Ritual } from './pages/Ciclo'
import { DEMO } from './lib/db'

applyTheme(savedTheme())

// guarda o convite aberto antes do login, para usar depois de entrar
const inv = location.pathname.match(/^\/convite\/([0-9a-f]{48})$/)
if (inv) try { localStorage.setItem('pending-invite', inv[1]) } catch { /* sem armazenamento */ }
const pendingInvite = () => { try { return localStorage.getItem('pending-invite') } catch { return null } }

function ConviteRoute() {
  const { token } = useParams()
  return token && /^[0-9a-f]{48}$/.test(token) ? <AceitarConvite token={token} /> : <Navigate to="/grupo" replace />
}

function Gate() {
  const { ready, session, demo, profile } = useAuth()
  const loc = useLocation()
  if (!ready) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }} className="muted">Carregando…</div>
  const signedIn = DEMO ? demo : !!session
  if (!signedIn) return <Login />
  if (!profile) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }} className="muted">Preparando sua conta…</div>
  if (!profile.onboarded) return <Onboarding />
  const pend = pendingInvite()
  if (pend && !DEMO && !loc.pathname.startsWith('/convite/')) return <Navigate to={`/convite/${pend}`} replace />
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Hoje />} />
        <Route path="agenda" element={<Agenda />} />
        <Route path="tarefas" element={<Tarefas />} />
        <Route path="tarefas/:key" element={<Tarefas />} />
        <Route path="tarefa/:id" element={<TarefaRoute />} />
        <Route path="financas" element={<Financas />} />
        <Route path="ciclo" element={<Ciclo />} />
        <Route path="ciclo/ritual" element={<Ritual />} />
        <Route path="ciclo/area/:id" element={<AreaPage />} />
        <Route path="grupo" element={<Grupo />} />
        <Route path="convite/:token" element={<ConviteRoute />} />
        <Route path="config" element={<Config />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider><Gate /></AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
