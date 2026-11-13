import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { DEMO, callFunction, exportAll, insert, removeWhere, syncExternalEvents, touch, update } from '../lib/db'
import { useRows } from '../lib/hooks'
import { CURRENCIES } from '../lib/money'
import { fetchEvents, getToken, listCalendars, syncCalendars } from '../lib/gcal'
import { fmt } from '../lib/dates'
import type { Area, AreaColor, Integration } from '../lib/types'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Shell'

type Theme = 'system' | 'light' | 'dark'
export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}
export const savedTheme = (): Theme => { try { return (localStorage.getItem('db-theme') as Theme) || 'system' } catch { return 'system' } }

const zones = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') } catch { return ['Europe/Lisbon', 'America/Sao_Paulo'] } })()
const COLORS: AreaColor[] = ['trabalho', 'estudos', 'saude', 'relacoes', 'financas', 'eu', 'neutro']
const ls = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* */ } }, del: (k: string) => { try { localStorage.removeItem(k) } catch { /* */ } } }

export function Config() {
  const { profile, saveProfile, signOut, deleteAccount, session } = useAuth()
  const [theme, setTheme] = useState<Theme>(savedTheme())
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { applyTheme(theme); ls.set('db-theme', theme) }, [theme])

  const download = async () => {
    const data = await exportAll()
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `dream-board-${new Date().toISOString().slice(0, 10)}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }

  if (!profile) return null
  const tz = profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  return (
    <div className="page wide" style={{ maxWidth: 1080 }}>
      <PageHeader eyebrow="Perfil" title="Configurações" />
      <div className="grid2">
        <section className="stack">
          <span className="mono muted">Perfil</span>
          <div className="card stack">
            <label className="field"><span>Nome</span><input className="input" defaultValue={profile.display_name} maxLength={80} onBlur={(e) => e.target.value.trim() && saveProfile({ display_name: e.target.value.trim() })} /></label>
            <div className="grid2" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <label className="field"><span>Moeda principal</span>
                <select className="input" value={profile.currency_main} onChange={(e) => saveProfile({ currency_main: e.target.value })}>{CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label>
              <label className="field"><span>A semana começa</span>
                <select className="input" value={profile.week_starts_on} onChange={(e) => saveProfile({ week_starts_on: Number(e.target.value) })}><option value={1}>segunda</option><option value={0}>domingo</option></select></label>
            </div>
            <label className="field"><span>Fuso horário</span>
              <select className="input" value={tz} onChange={(e) => saveProfile({ timezone: e.target.value })}>{(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z}>{z}</option>)}</select></label>
            {session?.user.email && <p className="caption muted" style={{ margin: 0 }}>Conta: {session.user.email}</p>}
          </div>

          <Areas />

          <span className="mono muted">Aparência</span>
          <div className="seg">{(['system', 'light', 'dark'] as Theme[]).map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t === 'system' ? 'Sistema' : t === 'light' ? 'Claro' : 'Escuro'}</button>)}</div>
        </section>

        <section className="stack">
          <Connections />

          <span className="mono muted">Pessoas</span>
          <div className="card flush list">
            <Link className="list-row" to="/grupo"><Icon name="users" /><span className="grow">Grupo e convites</span><Icon name="chevron" size={16} /></Link>
          </div>

          <span className="mono muted">Instalar o app</span>
          <div className="card caption muted stack" style={{ gap: 6 }}>
            <span><b>iPhone:</b> no Safari, Compartilhar → Adicionar à Tela de Início.</span>
            <span><b>Android e Chrome no Mac:</b> menu ⋮ → Instalar Dream Board.</span>
            <span>Atualizações chegam sozinhas. Se algo parecer antigo, feche e abra o app de novo.</span>
          </div>

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

// ---------------------------------------------------------------- áreas da vida
function Areas() {
  const { rows: areas } = useRows<Area>('areas', { order: { column: 'position' } })
  const [name, setName] = useState('')
  const [color, setColor] = useState<AreaColor>('neutro')
  const active = areas.filter((a) => !a.archived)
  const archived = areas.filter((a) => a.archived)
  return (
    <>
      <span className="mono muted">Áreas da vida</span>
      <div className="card flush list">
        {active.map((a) => (
          <div key={a.id} className="list-row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
            <ColorPick value={a.color} onChange={(c) => update<Area>('areas', a.id, { color: c })} />
            <input className="input bare grow" defaultValue={a.name} maxLength={40} aria-label={`Nome da área ${a.name}`} disabled={a.is_fixed}
              onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== a.name) update<Area>('areas', a.id, { name: v }) }} />
            {a.is_fixed ? <span className="caption muted row" style={{ gap: 4 }}><Icon name="lock" size={14} />sempre ativa</span> : (
              <>
                <span className="caption muted">foco</span>
                <Toggle label={`${a.name} em foco`} on={a.focus} onChange={(v) => update<Area>('areas', a.id, { focus: v })} />
                <button className="faint" aria-label={`Arquivar ${a.name}`} onClick={() => confirm(`Arquivar “${a.name}”? Metas e eventos ficam guardados.`) && update<Area>('areas', a.id, { archived: true, focus: false })}><Icon name="x" size={16} /></button>
              </>
            )}
          </div>
        ))}
        <form className="list-row" onSubmit={async (e) => { e.preventDefault(); const v = name.trim(); if (!v) return; setName('')
          await insert<Area>('areas', { name: v, color, icon: 'dot', position: areas.length + 1, focus: false, is_fixed: false, archived: false }) }}>
          <ColorPick value={color} onChange={setColor} />
          <input className="input bare grow" placeholder="Nova área" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} aria-label="Nova área" />
          <button className="btn secondary small" disabled={!name.trim()}>Adicionar</button>
        </form>
      </div>
      {archived.length > 0 && (
        <div className="chips">{archived.map((a) => <button key={a.id} className="chip" onClick={() => update<Area>('areas', a.id, { archived: false })}><Icon name="plus" size={12} />{a.name}</button>)}</div>
      )}
    </>
  )
}

function ColorPick({ value, onChange }: { value: AreaColor; onChange: (c: AreaColor) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" aria-label="Mudar cor" onClick={() => setOpen(!open)} className="dot" style={{ width: 18, height: 18, background: `var(--${value}-fg)`, display: 'block' }} />
      {open && (
        <span className="card row" style={{ position: 'absolute', top: 26, left: -8, zIndex: 5, padding: 8, gap: 6, boxShadow: 'var(--shadow-float)' }}>
          {COLORS.map((c) => <button type="button" key={c} aria-label={c} onClick={() => { onChange(c); setOpen(false) }} className="dot" style={{ width: 22, height: 22, background: `var(--${c}-fg)`, boxShadow: c === value ? '0 0 0 2px var(--bg-surface), 0 0 0 4px var(--ink)' : undefined }} />)}
        </span>
      )}
    </span>
  )
}

// ---------------------------------------------------------------- Google Agenda
function GoogleAgenda() {
  const { session, connectGoogleCalendar, signOut } = useAuth()
  const [sp, setSp] = useSearchParams()
  const [state, setState] = useState<{ busy: boolean; msg: string; err: boolean }>({ busy: false, msg: '', err: false })
  const last = ls.get('gcal-last')
  const ran = useRef(false)

  async function run() {
    const token = getToken()
    if (!token) { await connectGoogleCalendar(); return }
    setState({ busy: true, msg: 'Lendo suas agendas…', err: false })
    try {
      const cals = await listCalendars(token)
      try { await syncCalendars(cals) } catch (e) {
        const m = e instanceof Error ? e.message : String(e)
        if (/calendars/.test(m)) throw new Error('Falta rodar no Supabase o arquivo 20261108030000_agendas.sql.')
        throw e
      }
      setState({ busy: true, msg: `Trazendo eventos de ${cals.length} agenda${cals.length === 1 ? '' : 's'}…`, err: false })
      const { rows, timeMin, timeMax } = await fetchEvents(token, cals)
      const r = await syncExternalEvents(rows, 'gcal:', timeMin, timeMax)
      ls.set('gcal-last', new Date().toISOString())
      setState({ busy: false, msg: `Pronto: ${r.saved} eventos de ${cals.length} agenda${cals.length === 1 ? '' : 's'}${r.removed ? `, ${r.removed} apagados no Google saíram daqui` : ''}.`, err: false })
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      setState({ busy: false, err: true, msg: m.includes('external_id') ? 'Falta rodar no Supabase o arquivo 20261108020000_google_agenda.sql.' : m })
    }
  }

  // volta do Google: confere se é a mesma conta e importa
  useEffect(() => {
    if (sp.get('gcal') !== '1' || ran.current || !session) return
    ran.current = true
    const expected = ls.get('gcal-expect-user'); ls.del('gcal-expect-user')
    const n = new URLSearchParams(sp); n.delete('gcal'); setSp(n, { replace: true })
    if (expected && expected !== session.user.id) {
      setState({ busy: false, err: true, msg: 'Você escolheu uma conta Google com outro e-mail, e isso abriu outra conta no app. Vou sair dela: entre de novo com o seu e-mail e escolha a mesma conta Google.' })
      setTimeout(() => signOut(), 6000)
      return
    }
    run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sp, session])

  return (
    <div className="stack" style={{ gap: 6 }}>
      <button className="btn ghost small" style={{ alignSelf: 'flex-start' }} disabled={state.busy || DEMO} onClick={run}>{state.busy ? 'Importando…' : 'Importar agora, sem ligar'}</button>
      {state.msg && <span className="caption" style={{ color: state.err ? 'var(--danger)' : undefined }}>{state.msg}</span>}
      {last && !state.msg && <span className="caption muted">Última importação manual: {fmt(new Date(last), "d 'de' MMM 'às' HH:mm")}</span>}
    </div>
  )
}

// ---------------------------------------------------------------- ligações automáticas (servidor)
// Microsoft To Do fica pronto no servidor, mas escondido até haver um registro de app na Microsoft
const ACTIVE_SERVICES = ['google'] as const
const COLS = 'owner_id,provider,account_email,status,last_sync_at,last_error,created_at'
const SERVICES = {
  google: {
    title: 'Google Agenda', icon: 'calendar',
    desc: 'Atualiza sozinho a cada 15 minutos, mesmo com o app fechado: eventos novos, mudados e apagados. Só leitura, nada muda no Google. Na Agenda você escolhe quais agendas mostrar.',
  },
  microsoft: {
    title: 'Microsoft To Do', icon: 'check',
    desc: 'Nos dois sentidos: o que você cria, conclui, edita ou apaga aqui chega ao To Do em segundos, e o que muda lá aparece aqui em até 2 minutos. A lista “Tarefas” do To Do é a Inbox do app. As etapas dentro de uma tarefa ainda não sincronizam.',
  },
} as const

function Connections() {
  const { session } = useAuth()
  const { rows, error } = useRows<Integration>('integrations', { columns: COLS }, !DEMO)
  const [sp, setSp] = useSearchParams()
  const [notice, setNotice] = useState<{ msg: string; err: boolean } | null>(null)

  useEffect(() => {
    const ok = sp.get('conectado'), bad = sp.get('conexao')
    if (!ok && !bad) return
    const svc = (ok ?? sp.get('servico')) as keyof typeof SERVICES | null
    const name = svc && SERVICES[svc] ? SERVICES[svc].title : 'o serviço'
    const motivo = sp.get('motivo') ?? ''
    setNotice(ok ? { msg: `${name} ligado. A primeira sincronização começou e leva até 2 minutos.`, err: false }
      : { msg: motivo === 'cancelado' ? 'Você cancelou a ligação. Nada mudou.' : motivo.includes('permiss') ? 'Faltou marcar a caixinha da agenda na tela do Google. Tente de novo.' : `Não deu para ligar ${name}${motivo ? ` (${motivo})` : ''}.`, err: true })
    const n = new URLSearchParams(sp); ['conectado', 'conexao', 'servico', 'motivo', 'code'].forEach((k) => n.delete(k)); setSp(n, { replace: true })
  }, [sp, setSp])

  // enquanto a primeira sincronização não acaba, confere a cada 10 s
  const pending = rows.some((r) => !r.last_sync_at)
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => { touch('integrations'); touch('tasks'); touch('lists'); touch('events'); touch('calendars') }, 10000)
    return () => clearInterval(t)
  }, [pending])

  const missing = !!error && /integrations|schema cache|does not exist/i.test(String(error))
  return (
    <>
      <span className="mono muted">Sincronização automática</span>
      {notice && <div className={'banner caption'} style={notice.err ? { background: 'var(--relacoes-bg)', color: 'var(--relacoes-fg)' } : undefined}>{notice.msg}</div>}
      {DEMO ? <div className="card caption muted">Disponível só com a conta online.</div>
        : missing ? <div className="card caption" style={{ color: 'var(--danger)' }}>Falta rodar no Supabase o arquivo 20261112000000_sincronizacao.sql.</div>
        : (ACTIVE_SERVICES).map((p) => <ServiceCard key={p} provider={p} row={rows.find((r) => r.provider === p)} me={session?.user.id ?? ''} />)}
    </>
  )
}

function ServiceCard({ provider, row, me }: { provider: 'google' | 'microsoft'; row?: Integration; me: string }) {
  const svc = SERVICES[provider]
  const [busy, setBusy] = useState<'' | 'connect' | 'sync' | 'off'>('')
  const [msg, setMsg] = useState('')
  const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })

  async function connect() {
    setBusy('connect'); setMsg('')
    try { const { url } = await callFunction<{ url: string }>('connect', { provider }); location.assign(url) }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); setBusy('') }
  }
  async function syncNow() {
    setBusy('sync'); setMsg('')
    try {
      const r = await callFunction<{ report?: { error?: string; saved?: number; received?: number; sent?: number }[] }>('sync', { provider })
      const x = r.report?.[0]
      setMsg(x?.error ? x.error : provider === 'google' ? `Pronto: ${x?.saved ?? 0} eventos conferidos.` : `Pronto: ${x?.sent ?? 0} enviadas, ${x?.received ?? 0} recebidas.`)
      ;['integrations', 'events', 'calendars', 'tasks', 'lists'].forEach((t) => touch(t as never))
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  async function off() {
    const extra = provider === 'microsoft' ? ' Suas listas e tarefas ficam no app e no To Do, só deixam de se atualizar uma à outra.' : ' Os eventos já importados ficam no app.'
    if (!confirm(`Desligar ${svc.title}?${extra} A chave guardada é apagada.`)) return
    setBusy('off')
    try { await removeWhere('integrations', { owner_id: me, provider }) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }

  return (
    <div className="card stack" style={{ gap: 10 }}>
      <div className="row">
        <Icon name={svc.icon} />
        <span className="grow medium">{svc.title}</span>
        {row && <span className="pill caption" style={{ background: row.status === 'error' ? 'var(--relacoes-bg)' : 'var(--saude-bg)', color: row.status === 'error' ? 'var(--relacoes-fg)' : 'var(--saude-fg)' }}>{row.status === 'error' ? 'com erro' : 'ligado'}</span>}
      </div>
      <p className="caption muted" style={{ margin: 0 }}>{svc.desc}</p>
      {row ? (
        <>
          <span className="caption">
            {row.account_email && <>Conta: {row.account_email}<br /></>}
            {row.last_sync_at ? `Última sincronização ${ago(row.last_sync_at)}.` : 'Primeira sincronização em andamento…'}
          </span>
          {row.status === 'error' && row.last_error && <span className="caption" style={{ color: 'var(--danger)' }}>{row.last_error}</span>}
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            <button className="btn secondary small" disabled={!!busy} onClick={syncNow}>{busy === 'sync' ? 'Sincronizando…' : 'Sincronizar agora'}</button>
            {row.status === 'error' && <button className="btn secondary small" disabled={!!busy} onClick={connect}>Ligar de novo</button>}
            <button className="btn ghost small" disabled={!!busy} onClick={off}>Desligar</button>
          </div>
        </>
      ) : (
        <button className="btn primary" disabled={!!busy} onClick={connect}>{busy === 'connect' ? 'Abrindo…' : `Ligar ${svc.title}`}</button>
      )}
      {msg && <span className="caption">{msg}</span>}
      {provider === 'google' && !row && <GoogleAgenda />}
    </div>
  )
}
