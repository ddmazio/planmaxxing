import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../lib/auth'
import { DEMO, callFunction, exportAll, insert, removeImportedGoogle, removeWhere, select, syncExternalEvents, touch, update, updateWhere } from '../lib/db'
import { currentSub, disablePush, enablePush, pushSupport, testPush } from '../lib/push'
import { CurrencySheet } from './Financas'
import { useRows } from '../lib/hooks'
import { CURRENCY_INFO } from '../lib/money'
import { fetchEvents, getToken, listCalendars, syncCalendars } from '../lib/gcal'
import { INTEGRATION_COLS } from '../lib/calendars'
import { fmt } from '../lib/dates'
import type { Area, AreaColor, CalEvent, Integration, PushSub } from '../lib/types'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { AreaIcon, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Shell'
import { useIsAdmin } from './Admin'

type Theme = 'system' | 'light' | 'dark'
export function applyTheme(t: Theme) {
  if (t === 'system') document.documentElement.removeAttribute('data-theme')
  else document.documentElement.setAttribute('data-theme', t)
}
export const savedTheme = (): Theme => { try { return (localStorage.getItem('db-theme') as Theme) || 'system' } catch { return 'system' } }

const zones = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') } catch { return ['Europe/Lisbon', 'America/Sao_Paulo'] } })()
const COLORS: AreaColor[] = ['trabalho', 'estudos', 'saude', 'relacoes', 'financas', 'eu', 'neutro']
const ls = { get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* */ } }, del: (k: string) => { try { localStorage.removeItem(k) } catch { /* */ } } }

function Back() { return <Link to="/config" className="row caption muted" style={{ gap: 4, alignSelf: 'flex-start' }}><Icon name="back" size={16} />Configurações</Link> }
function Row({ icon, label, value, to, onClick, children }: { icon: string; label: string; value?: string; to?: string; onClick?: () => void; children?: React.ReactNode }) {
  const inner = <><Icon name={icon} /><span className="grow" style={{ textAlign: 'left' }}>{label}</span>{value && <span className="caption muted">{value}</span>}{children}{(to || onClick) && <Icon name="chevron" size={16} className="faint" />}</>
  return to ? <Link className="list-row" to={to}>{inner}</Link> : onClick ? <button className="list-row" onClick={onClick}>{inner}</button> : <div className="list-row">{inner}</div>
}
const gmt = (tz: string) => { try { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((x) => x.type === 'timeZoneName')?.value ?? ''; return p.replace('GMT', 'GMT') } catch { return '' } }

export function Config() {
  const { profile, saveProfile, signOut, session } = useAuth()
  const [theme, setTheme] = useState<Theme>(savedTheme())
  const [curOpen, setCurOpen] = useState(false)
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false } })
  const { rows: integ } = useRows<Integration>('integrations', { columns: COLS }, !DEMO)
  const [pushOn, setPushOn] = useState<boolean | null>(null)
  const isAdmin = useIsAdmin()
  const [sp] = useSearchParams()
  const nav = useNavigate()
  // a volta do Google (…/config?conectado=google) abre a página de conexões
  useEffect(() => { if (sp.has('conectado') || sp.has('conexao') || sp.has('gcal')) nav(`/config/conexoes?${sp.toString()}`, { replace: true }) }, [sp, nav])
  useEffect(() => { applyTheme(theme); ls.set('db-theme', theme) }, [theme])
  useEffect(() => { currentSub().then((s) => setPushOn(!!s)).catch(() => setPushOn(false)) }, [])

  if (!profile) return null
  const tz = profile.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const city = tz.split('/').pop()?.replace(/_/g, ' ')
  const google = integ.find((i) => i.provider === 'google')
  const extra = (profile.currencies_extra ?? []).map((c) => CURRENCY_INFO[c]?.name.split(' ')[0]).filter(Boolean)
  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <button className="row caption muted" style={{ gap: 4, alignSelf: 'flex-start' }} onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = '/'))}><Icon name="back" size={16} />Voltar</button>
      <PageHeader eyebrow="Perfil" title="Configurações" />
      <span className="caption muted" style={{ marginTop: -12 }}>{city} ({gmt(tz)}){google ? ' · conta Google' : ''}{session?.user.email ? ` · ${session.user.email}` : ''}</span>

      <div className="card stack">
        <label className="field"><span>Nome</span><input className="input" defaultValue={profile.display_name} maxLength={80} onBlur={(e) => e.target.value.trim() && saveProfile({ display_name: e.target.value.trim() })} /></label>
        <label className="field"><span>Fuso horário</span>
          <select className="input" value={tz} onChange={(e) => saveProfile({ timezone: e.target.value })}>{(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z}>{z}</option>)}</select></label>
      </div>

      <span className="mono muted">Planejamento</span>
      <div className="card flush list">
        <Row icon="target" label="Áreas da vida" value={String(areas.length)} to="/config/areas" />
        <Row icon="clock" label="Ciclo padrão" value="12 semanas + 1 de revisão" />
        <Row icon="calendar" label="A semana começa">
          <select className="input" style={{ width: 'auto', minHeight: 34 }} value={profile.week_starts_on} onChange={(e) => saveProfile({ week_starts_on: Number(e.target.value) })} aria-label="A semana começa"><option value={1}>segunda</option><option value={0}>domingo</option></select>
        </Row>
      </div>

      <span className="mono muted">App</span>
      <div className="card flush list">
        <Row icon="bell" label="Notificações" value={DEMO ? 'precisa de conta' : pushOn == null ? '' : pushOn ? 'ligadas neste aparelho' : 'desligadas'} to="/config/notificacoes" />
        <Row icon="repeat" label="Conexões" value={google ? 'Google' : 'nenhuma'} to="/config/conexoes" />
        <Row icon="sun" label="Aparência">
          <div className="seg small" style={{ minWidth: 220 }}>{(['system', 'light', 'dark'] as Theme[]).map((t) => <button key={t} className={theme === t ? 'on' : ''} onClick={() => setTheme(t)}>{t === 'system' ? 'Sistema' : t === 'light' ? 'Claro' : 'Escuro'}</button>)}</div>
        </Row>
        <Row icon="note" label="Idioma" value="Português" />
        <Row icon="wallet" label="Moeda" value={`${CURRENCY_INFO[profile.currency_main]?.name.split(' ')[0] ?? profile.currency_main}${extra.length ? ` · também ${extra.join(', ')}` : ''}`} onClick={() => setCurOpen(true)} />
      </div>
      <div className="card caption muted stack" style={{ gap: 6 }}>
        <span className="mono">Instalar o app</span>
        <span><b>iPhone:</b> no Safari, Compartilhar → Adicionar à Tela de Início.</span>
        <span><b>Android e Chrome no Mac:</b> menu ⋮ → Instalar Twelvefold.</span>
        <span>Atualizações chegam sozinhas. Se algo parecer antigo, feche e abra o app de novo.</span>
      </div>

      {isAdmin && <>
        <span className="mono muted">Só você</span>
        <div className="card flush list">
          <Link className="list-row" to="/config/admin"><span className="owner-ico"><Icon name="lock" size={16} /></span><span className="grow stack" style={{ gap: 0, textAlign: 'left' }}><span className="medium">Painel do app</span><span className="caption muted">Pessoas, recursos em teste e avisos</span></span><span className="tag-pill lime">dona</span><Icon name="chevron" size={16} className="faint" /></Link>
        </div>
      </>}
      <span className="mono muted">Conta</span>
      <div className="card flush list">
        <Row icon="users" label="Grupo e convites" to="/grupo" />
        <Row icon="shield" label="Dados e privacidade" to="/config/dados" />
        <button className="list-row" onClick={signOut}><Icon name="logout" /><span className="grow" style={{ textAlign: 'left' }}>Sair</span></button>
      </div>
      <p className="caption faint row" style={{ margin: 0 }}><Icon name="shield" size={16} />Ninguém além de você lê seus dados. Finanças nunca aparecem para o grupo.</p>
      <CurrencySheet open={curOpen} onClose={() => setCurOpen(false)} />
    </div>
  )
}

export function ConfigAreas() {
  return <div className="page" style={{ maxWidth: 720 }}><Back /><PageHeader eyebrow="Planejamento" title="Áreas da vida" /><Areas /></div>
}
export function ConfigConexoes() {
  return <div className="page" style={{ maxWidth: 720 }}><Back /><PageHeader eyebrow="App" title="Conexões" /><Connections /></div>
}

// ---------------------------------------------------------------- notificações
const NOTI_DEF = {
  plan: { on: true, time: '18:00' }, close: { on: true, time: '20:30' }, checkin: { on: true, before: 15 },
  morning: { on: true, time: '08:00' }, habits: { on: true }, events: { on: true },
  cheers: { on: true }, scores: { on: false }, quiet: { on: true, from: '23:00', to: '07:30' },
}
type NotiPrefs = typeof NOTI_DEF
export function ConfigNotificacoes() {
  const { profile, saveProfile } = useAuth()
  const { rows: devices } = useRows<PushSub>('push_subscriptions', { order: { column: 'created_at' } }, !DEMO)
  const [here, setHere] = useState<string | null | undefined>(undefined)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { currentSub().then((s) => setHere(s?.endpoint ?? null)).catch(() => setHere(null)) }, [])
  if (!profile) return null
  const raw = (profile.notify ?? {}) as Partial<Record<keyof NotiPrefs, object>>
  const p = Object.fromEntries(Object.entries(NOTI_DEF).map(([k, v]) => [k, { ...v, ...(raw[k as keyof NotiPrefs] ?? {}) }])) as NotiPrefs
  const set = <K extends keyof NotiPrefs>(k: K, patch: Partial<NotiPrefs[K]>) => saveProfile({ notify: { ...(profile.notify ?? {}), [k]: { ...p[k], ...patch } } })
  const support = pushSupport()
  const active = !!here && devices.some((d) => d.endpoint === here)

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setBusy(true); setMsg('')
    try { await fn(); if (ok) setMsg(ok) } catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
    setBusy(false); touch('push_subscriptions'); currentSub().then((s) => setHere(s?.endpoint ?? null)).catch(() => {})
  }
  const Time = ({ value, onChange, label }: { value: string; onChange: (v: string) => void; label: string }) =>
    <input type="time" className="input" style={{ width: 132, minHeight: 34 }} defaultValue={value} aria-label={label} onBlur={(e) => e.target.value && e.target.value !== value && onChange(e.target.value)} />
  const line = (label: string, sub: string, on: boolean, toggle: (v: boolean) => void, extra?: React.ReactNode) => (
    <div className="list-row" style={{ flexWrap: 'wrap', rowGap: 6 }}>
      <div className="grow stack" style={{ gap: 0, minWidth: 160 }}><span>{label}</span><span className="caption muted">{sub}</span></div>
      {on && extra}
      <Toggle label={label} on={on} onChange={toggle} />
    </div>
  )

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Back />
      <PageHeader eyebrow="Notificações" title="Notificações" />
      <div className="card stack" style={{ gap: 10 }}>
        <span className="medium">Neste aparelho</span>
        {DEMO ? <span className="caption muted">Avisos precisam da conta online.</span>
          : support === 'ios-install' ? <span className="caption muted">No iPhone, os avisos só funcionam com o app instalado: no Safari, Compartilhar → Adicionar à Tela de Início. Depois abra o Twelvefold por lá e volte aqui.</span>
          : support === 'no' ? <span className="caption muted">Este navegador não recebe avisos.</span>
          : active ? (
            <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="pill caption ok">ligadas</span>
              <button className="btn secondary small" disabled={busy} onClick={() => act(async () => { const r = await testPush(); if (!r.sent) throw new Error('O aviso não saiu. Tente desligar e ligar de novo.') }, 'Aviso de teste enviado.')}>Enviar um teste</button>
              <button className="btn ghost small" disabled={busy} onClick={() => act(disablePush, 'Desligadas neste aparelho.')}>Desligar aqui</button>
            </div>
          ) : <button className="btn primary" disabled={busy} onClick={() => act(enablePush, 'Pronto. Os avisos vão chegar neste aparelho.')}>{busy ? 'Ligando…' : 'Ligar avisos neste aparelho'}</button>}
        {msg && <span className="caption">{msg}</span>}
        {devices.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            <span className="caption muted">Aparelhos com avisos ligados</span>
            {devices.map((d) => (
              <div key={d.id} className="row between caption">
                <span>{d.device ?? 'Aparelho'}{d.endpoint === here ? ' (este)' : ''}</span>
                <button className="faint" aria-label="Tirar aparelho" onClick={() => removeWhere('push_subscriptions', { id: d.id })}><Icon name="x" size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <span className="mono muted">Rituais</span>
      <div className="card flush list">
        {line('Planejar a semana', `Domingo, ${p.plan.time}`, p.plan.on, (v) => set('plan', { on: v }), <Time label="Hora de planejar" value={p.plan.time} onChange={(v) => set('plan', { time: v })} />)}
        {line('Fechar a semana', `Domingo, ${p.close.time}`, p.close.on, (v) => set('close', { on: v }), <Time label="Hora de fechar" value={p.close.time} onChange={(v) => set('close', { time: v })} />)}
        {line('Check-in do grupo', `${p.checkin.before} min antes (09:00 no dia do grupo)`, p.checkin.on, (v) => set('checkin', { on: v }),
          <select className="input" style={{ width: 'auto', minHeight: 34 }} value={p.checkin.before} onChange={(e) => set('checkin', { before: Number(e.target.value) })} aria-label="Minutos antes">{[0, 15, 30, 60].map((m) => <option key={m} value={m}>{m ? `${m} min antes` : 'na hora'}</option>)}</select>)}
      </div>

      <span className="mono muted">Dia a dia</span>
      <div className="card flush list">
        {line('Resumo da manhã', `${p.morning.time} · passos e agenda`, p.morning.on, (v) => set('morning', { on: v }), <Time label="Hora do resumo" value={p.morning.time} onChange={(v) => set('morning', { time: v })} />)}
        {line('Lembretes de hábitos', 'no horário de cada hábito', p.habits.on, (v) => set('habits', { on: v }))}
        {line('Compromissos', 'conforme o lembrete de cada evento e tarefa', p.events.on, (v) => set('events', { on: v }))}
      </div>

      <span className="mono muted">Grupo</span>
      <div className="card flush list">
        {line('Incentivos recebidos', 'quando alguém te manda um 👏', p.cheers.on, (v) => set('cheers', { on: v }))}
        {line('Placar das outras pessoas', 'pode gerar comparação', p.scores.on, (v) => set('scores', { on: v }))}
      </div>

      <span className="mono muted">Silêncio</span>
      <div className="card flush list">
        {line('Não perturbar', `${p.quiet.from} às ${p.quiet.to}`, p.quiet.on, (v) => set('quiet', { on: v }),
          <span className="row" style={{ gap: 6 }}><Time label="Início" value={p.quiet.from} onChange={(v) => set('quiet', { from: v })} /><span className="caption">às</span><Time label="Fim" value={p.quiet.to} onChange={(v) => set('quiet', { to: v })} /></span>)}
      </div>
      <p className="caption muted" style={{ margin: 0 }}>No silêncio só chegam os lembretes que você marcou num evento ou numa tarefa. Os horários seguem o seu fuso ({profile.timezone}).</p>
    </div>
  )
}

// ---------------------------------------------------------------- dados
function icsEscape(s: string) { return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, (m) => '\\' + m) }
function icsFold(line: string) { const out: string[] = []; let l = line; while (l.length > 73) { out.push(l.slice(0, 73)); l = ' ' + l.slice(73) } out.push(l); return out.join('\r\n') }
export function toIcs(events: CalEvent[]) {
  const dt = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d+/, '').replace(/Z?$/, 'Z')
  const d = (iso: string) => { const x = new Date(iso); return `${x.getFullYear()}${String(x.getMonth() + 1).padStart(2, '0')}${String(x.getDate()).padStart(2, '0')}` }
  const now = dt(new Date().toISOString())
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twelvefold//PT', 'CALSCALE:GREGORIAN']
  for (const e of events) {
    lines.push('BEGIN:VEVENT', `UID:${e.id}@dreamboard`, `DTSTAMP:${now}`,
      e.all_day ? `DTSTART;VALUE=DATE:${d(e.starts_at)}` : `DTSTART:${dt(new Date(e.starts_at).toISOString())}`,
      e.all_day ? `DTEND;VALUE=DATE:${d(e.ends_at)}` : `DTEND:${dt(new Date(e.ends_at).toISOString())}`,
      `SUMMARY:${icsEscape(e.title)}`)
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`)
    if (e.notes) lines.push(`DESCRIPTION:${icsEscape(e.notes)}`)
    lines.push('END:VEVENT')
  }
  lines.push('END:VCALENDAR')
  return lines.map(icsFold).join('\r\n') + '\r\n'
}

export function ConfigDados() {
  const { profile, saveProfile, deleteAccount, session } = useAuth()
  const { rows: integ } = useRows<Integration>('integrations', { columns: COLS }, !DEMO)
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!profile) return null
  const google = integ.find((i) => i.provider === 'google')
  const consent = ((profile.notify ?? {}) as { consents?: { usage?: boolean; suggestions?: boolean } }).consents ?? {}
  const setConsent = (k: 'usage' | 'suggestions', v: boolean) => saveProfile({ notify: { ...(profile.notify ?? {}), consents: { ...consent, [k]: v } } })
  const save = (blob: Blob, name: string) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000) }
  const day = new Date().toISOString().slice(0, 10)

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Back />
      <PageHeader eyebrow="Dados" title="Seus dados" />
      <p className="muted" style={{ margin: '-8px 0 0' }}>Tudo o que você escreve aqui é seu. Os dados ficam em servidores na União Europeia.</p>

      <span className="mono muted">Baixar</span>
      <div className="card flush list">
        <button className="list-row" onClick={async () => { const data = await exportAll(); save(new Blob([JSON.stringify({ exported_at: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' }), `twelvefold-${day}.json`) }}>
          <Icon name="download" /><div className="grow stack" style={{ gap: 0, textAlign: 'left' }}><span>Exportar tudo (JSON)</span><span className="caption muted">metas, passos, hábitos, agenda, reflexões</span></div><Icon name="chevron" size={16} className="faint" /></button>
        <button className="list-row" onClick={async () => { const evs = await select<CalEvent>('events', { order: { column: 'starts_at' } }); save(new Blob([toIcs(evs)], { type: 'text/calendar' }), `twelvefold-agenda-${day}.ics`) }}>
          <Icon name="calendar" /><div className="grow stack" style={{ gap: 0, textAlign: 'left' }}><span>Exportar agenda (.ics)</span><span className="caption muted">abre no Google, Apple ou Outlook</span></div><Icon name="chevron" size={16} className="faint" /></button>
      </div>

      <span className="mono muted">Conexões</span>
      <div className="card flush list">
        <div className="list-row"><Icon name="calendar" /><div className="grow stack" style={{ gap: 0 }}><span>Google Calendar</span><span className="caption muted">{google ? `conectado${google.account_email ? ` · ${google.account_email}` : ''}` : 'não conectado'}</span></div>
          {!google && <Link className="caption medium" to="/config/conexoes">Conectar</Link>}</div>
        {google && <button className="list-row" disabled={busy} style={{ color: 'var(--danger)' }} onClick={async () => {
          if (!window.confirm('Desconectar o Google e apagar do app os eventos que vieram de lá? Os eventos continuam no Google. O que você criou no app fica.')) return
          setBusy(true); setMsg('')
          try { await removeWhere('integrations', { owner_id: session!.user.id, provider: 'google' }); await removeImportedGoogle(session!.user.id); setMsg('Google desconectado e eventos importados apagados.') }
          catch (e) { setMsg(e instanceof Error ? e.message : String(e)) }
          setBusy(false)
        }}><Icon name="x" /><span className="grow" style={{ textAlign: 'left' }}>Desconectar e apagar eventos importados</span></button>}
      </div>
      {msg && <span className="caption">{msg}</span>}

      <span className="mono muted">Consentimentos</span>
      <div className="card flush list">
        <div className="list-row"><div className="grow stack" style={{ gap: 0 }}><span>Dados de uso anônimos</span><span className="caption muted">ajudam a melhorar o app. Hoje o app não coleta nenhum; se um dia coletar, só com isto ligado.</span></div>
          <Toggle label="Dados de uso anônimos" on={!!consent.usage} onChange={(v) => setConsent('usage', v)} /></div>
        <div className="list-row"><div className="grow stack" style={{ gap: 0 }}><span>Usar minhas respostas para sugestões</span><span className="caption muted">só no seu aparelho e na sua conta (ex.: a inspiração da nova meta e o tipo sugerido de um gasto)</span></div>
          <Toggle label="Usar minhas respostas para sugestões" on={consent.suggestions !== false} onChange={(v) => setConsent('suggestions', v)} /></div>
      </div>

      <div className="card stack">
        <span className="mono" style={{ color: 'var(--danger)' }}>Zona de cuidado</span>
        <span className="medium">Apagar conta e todos os dados</span>
        <p className="caption muted" style={{ margin: 0 }}>{DEMO ? 'Apaga tudo o que está guardado neste aparelho.' : 'Apaga a sua conta e todos os seus dados dos servidores na hora. Não há volta: baixe o JSON antes, se quiser guardar.'} Escreva APAGAR para confirmar.</p>
        <input className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Confirmação" placeholder="APAGAR" />
        <button className="btn danger" disabled={confirm !== 'APAGAR' || busy} onClick={async () => { setBusy(true); try { await deleteAccount() } finally { setBusy(false) } }}>Apagar conta e dados</button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- áreas da vida
function Areas() {
  const { rows: areas } = useRows<Area>('areas', { order: { column: 'position' } })
  const loaded = areas.length > 0
  useEffect(() => { if (loaded && location.hash === '#areas') document.getElementById('areas')?.scrollIntoView({ behavior: 'smooth' }) }, [loaded])
  const [name, setName] = useState('')
  const [color, setColor] = useState<AreaColor>('neutro')
  const [icon, setIcon] = useState('dot')
  const active = areas.filter((a) => !a.archived)
  const archived = areas.filter((a) => a.archived)
  return (
    <>
      <span className="mono muted" id="areas" style={{ scrollMarginTop: 24 }}>Áreas da vida</span>
      <div className="card flush list">
        {active.map((a) => (
          <div key={a.id} className="list-row" style={{ flexWrap: 'wrap', rowGap: 8 }}>
            <LookPick color={a.color} icon={a.icon} onChange={(patch) => update<Area>('areas', a.id, patch)} />
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
          await insert<Area>('areas', { name: v, color, icon, position: areas.length + 1, focus: false, is_fixed: false, archived: false }) }}>
          <LookPick color={color} icon={icon} onChange={(p) => { if (p.color) setColor(p.color); if (p.icon) setIcon(p.icon) }} />
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

const ICONS = ['briefcase', 'book', 'heart', 'users', 'wallet', 'sparkle', 'sun', 'star', 'home', 'target', 'pin', 'note', 'clock', 'bell', 'dot']

/** Cor e ícone de uma área: toca no quadradinho para escolher. */
function LookPick({ color, icon, onChange }: { color: AreaColor; icon: string; onChange: (p: { color?: AreaColor; icon?: string }) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <span style={{ position: 'relative' }}>
      <button type="button" aria-label="Mudar cor e ícone" aria-expanded={open} onClick={() => setOpen(!open)} style={{ display: 'block' }}><AreaIcon area={{ color, icon }} size={32} /></button>
      {open && (
        <span className="card stack look-pop" onMouseLeave={() => setOpen(false)}>
          <span className="mono muted">Cor</span>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {COLORS.map((c) => <button type="button" key={c} aria-label={c} aria-pressed={c === color} onClick={() => onChange({ color: c })} className="dot" style={{ width: 24, height: 24, background: `var(--${c}-bg)`, boxShadow: c === color ? '0 0 0 2px var(--bg-surface), 0 0 0 4px var(--ink)' : undefined }} />)}
          </span>
          <span className="mono muted">Ícone</span>
          <span className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
            {ICONS.map((i) => <button type="button" key={i} aria-label={i === 'dot' ? 'sem ícone' : i} aria-pressed={i === icon} onClick={() => { onChange({ icon: i }); setOpen(false) }}
              style={{ borderRadius: 10, boxShadow: i === icon ? '0 0 0 2px var(--ink)' : undefined }}><AreaIcon area={{ color, icon: i }} size={32} /></button>)}
          </span>
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
const COLS = INTEGRATION_COLS
const SERVICES = {
  google: {
    title: 'Google Agenda', icon: 'calendar',
    desc: 'Atualiza sozinho a cada 15 minutos, mesmo com o app fechado: eventos novos, mudados e apagados. Na Agenda você escolhe quais agendas mostrar e, se quiser, salva compromissos lá também.',
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
    const noWrite = sp.get('escrita') === 'nao'
    setNotice(ok ? { msg: `${name} ligado. A primeira sincronização começou e leva até 2 minutos.${noWrite ? ' A caixinha de criar e editar eventos ficou desmarcada, então o app só lê a sua agenda.' : ''}`, err: false }
      : { msg: motivo === 'cancelado' ? 'Você cancelou a ligação. Nada mudou.' : motivo.includes('permiss') ? 'Faltou marcar a caixinha da agenda na tela do Google. Tente de novo.' : `Não deu para ligar ${name}${motivo ? ` (${motivo})` : ''}.`, err: true })
    const n = new URLSearchParams(sp); ['conectado', 'conexao', 'servico', 'motivo', 'code', 'escrita'].forEach((k) => n.delete(k)); setSp(n, { replace: true })
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

/** Escrever no Google: precisa da permissão de escrita; "nos dois sentidos" é escolha da pessoa. */
function GoogleWrite({ row, busy, onReconnect, me }: { row: Integration; busy: boolean; onReconnect: () => void; me: string }) {
  const [err, setErr] = useState('')
  if (!row.can_write) return (
    <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <span className="medium">Salvar compromissos no Google</span>
      <span className="caption muted">Hoje o app só lê a sua agenda. Para salvar compromissos lá e sincronizar nos dois sentidos, o Google precisa da permissão de criar e editar eventos. Você liga de novo e marca a caixinha.</span>
      <button className="btn secondary small" style={{ alignSelf: 'flex-start' }} disabled={busy} onClick={onReconnect}>Permitir salvar no Google</button>
    </div>
  )
  const set = async (v: boolean) => {
    setErr('')
    try { await updateWhere('integrations', { owner_id: me, provider: 'google' }, { two_way: v }) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }
  return (
    <div className="stack" style={{ gap: 8, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
      <span className="medium">Como sincronizar</span>
      <button className={'choice' + (row.two_way ? ' on' : '')} aria-pressed={!!row.two_way} onClick={() => set(true)}>
        <span className="medium">Nos dois sentidos</span>
        <span className="caption muted">O que você cria, muda ou apaga aqui vai para o Google, inclusive nos eventos que vieram de lá. Se algo mudar nos dois lugares, o app pergunta qual versão fica.</span>
      </button>
      <button className={'choice' + (!row.two_way ? ' on' : '')} aria-pressed={!row.two_way} onClick={() => set(false)}>
        <span className="medium">Só trazer para cá</span>
        <span className="caption muted">O Google continua sendo o lugar de editar. Só vai para lá o compromisso em que você marcar “Salvar também no Google”.</span>
      </button>
      {err && <span className="caption" style={{ color: 'var(--danger)' }}>{err}</span>}
    </div>
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
      {provider === 'google' && row && <GoogleWrite row={row} busy={!!busy} onReconnect={connect} me={me} />}
      {provider === 'google' && !row && <GoogleAgenda />}
    </div>
  )
}
