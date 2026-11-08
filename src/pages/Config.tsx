import { useEffect, useState } from 'react'
import { useAuth } from '../lib/auth'
import { DEMO, exportAll } from '../lib/db'
import { CURRENCIES } from '../lib/money'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Shell'

type Theme = 'system' | 'light' | 'dark'
export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}
export const savedTheme = (): Theme => { try { return (localStorage.getItem('db-theme') as Theme) || 'system' } catch { return 'system' } }

export function Config() {
  const { profile, saveProfile, signOut, deleteAccount, session } = useAuth()
  const [theme, setTheme] = useState<Theme>(savedTheme())
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { applyTheme(theme); try { localStorage.setItem('db-theme', theme) } catch { /* sem armazenamento */ } }, [theme])

  const download = async () => {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dream-board-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  if (!profile) return null
  return (
    <div className="page">
      <PageHeader eyebrow="Perfil" title="Configurações" />
      <div className="grid2">
        <section className="stack">
          <span className="mono muted">Perfil</span>
          <div className="card stack">
            <label className="field"><span>Nome</span><input className="input" defaultValue={profile.display_name} maxLength={80} onBlur={(e) => saveProfile({ display_name: e.target.value.trim() })} /></label>
            <label className="field"><span>Moeda principal</span>
              <select className="input" value={profile.currency_main} onChange={(e) => saveProfile({ currency_main: e.target.value })}>{CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
            <label className="field"><span>A semana começa</span>
              <select className="input" value={profile.week_starts_on} onChange={(e) => saveProfile({ week_starts_on: Number(e.target.value) })}><option value={1}>segunda</option><option value={0}>domingo</option></select></label>
            {session?.user.email && <p className="caption muted" style={{ margin: 0 }}>Conta: {session.user.email}</p>}
          </div>
          <span className="mono muted">Aparência</span>
          <div className="seg">{(['system', 'light', 'dark'] as Theme[]).map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t === 'system' ? 'Sistema' : t === 'light' ? 'Claro' : 'Escuro'}</button>)}</div>
        </section>
        <section className="stack">
          <span className="mono muted">Seus dados</span>
          <div className="card flush list">
            <button className="list-row" onClick={download}><Icon name="download" /><span className="grow">Exportar tudo (JSON)</span><Icon name="chevron" size={16} /></button>
            <button className="list-row" onClick={signOut}><Icon name="logout" /><span className="grow">Sair</span></button>
          </div>
          <div className="card stack">
            <span className="mono" style={{ color: 'var(--danger)' }}>Zona de cuidado</span>
            <p className="caption muted" style={{ margin: 0 }}>{DEMO ? 'Apaga tudo o que está guardado neste aparelho.' : 'Apaga a sua conta e todos os seus dados dos servidores. Não há volta.'} Escreva APAGAR para confirmar.</p>
            <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirmação" placeholder="APAGAR" />
            <button className="btn danger" disabled={confirm !== 'APAGAR' || busy} onClick={async () => { setBusy(true); try { await deleteAccount() } finally { setBusy(false) } }}>Apagar conta e dados</button>
          </div>
          <p className="caption faint row" style={{ margin: 0 }}><Icon name="shield" size={16} />Ninguém além de você lê seus dados. Finanças nunca aparecem para o grupo.</p>
        </section>
      </div>
    </div>
  )
}
