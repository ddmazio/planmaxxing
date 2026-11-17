import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { DEMO, callFunction, rpc } from '../lib/db'
import { FEATURES, refreshApp, type AppSettings, type Rollout } from '../lib/app'
import { fmt } from '../lib/dates'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Shell'
import { Sheet, Toggle } from '../components/ui'

export interface Person {
  id: string; email: string; name: string | null; created_at: string; last_sign_in_at: string | null
  blocked: boolean; pending: boolean; admin: boolean
}
interface Panel {
  people: number; active_week: number; invites_open: number
  notifications_today: number; sync_errors: number; sync_pending: number; last_sync: string | null
  flags: Record<string, Rollout>; testers: string[]; settings: AppSettings
}

/** A conta logada é dona do app? (o servidor confere de novo em toda ação) */
export function useIsAdmin() {
  const [admin, setAdmin] = useState(false)
  useEffect(() => { if (!DEMO) rpc<boolean>('am_i_admin', {}).then((v) => setAdmin(v === true)).catch(() => setAdmin(false)) }, [])
  return admin
}

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })
const LEVELS: [Rollout, string][] = [['owner', 'Só eu'], ['testers', 'Testadores'], ['all', 'Todos']]
const msg = (e: unknown) => {
  const m = e instanceof Error ? e.message : typeof e === 'object' && e && 'message' in e ? String((e as { message: unknown }).message) : String(e)
  return /admin_panel|my_features|app_settings|does not exist|Could not find/.test(m) ? 'O painel ainda não está ligado no servidor (falta rodar o SQL do painel no Supabase).' : m
}

/** Configurações → Painel do app: só a dona vê. */
export function ConfigAdmin() {
  const admin = useIsAdmin()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [err, setErr] = useState('')
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<Person | null>(null)
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState<{ text: string; until: string } | null>(null)

  const loadPeople = useCallback(async () => {
    try { setPeople((await callFunction<{ people: Person[] }>('admin', { action: 'list' })).people) } catch (e) { setErr(msg(e)) }
  }, [])
  const loadPanel = useCallback(async () => {
    try { setPanel(await rpc<Panel>('admin_panel')) } catch (e) { setErr(msg(e)) }
  }, [])
  useEffect(() => { if (admin) { loadPeople(); loadPanel() } }, [admin, loadPeople, loadPanel])

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr('')
    try { await fn(); await loadPanel(); refreshApp() } catch (e) { setErr(msg(e)) }
    setBusy('')
  }
  const act = async (action: 'block' | 'unblock' | 'delete', p: Person) => {
    setBusy(action); setErr('')
    try { await callFunction('admin', { action, id: p.id }); setOpen(null); await loadPeople(); loadPanel() } catch (e) { setErr(msg(e)) }
    setBusy('')
  }
  const invite = async () => {
    setBusy('invite'); setErr(''); setLink(null); setCopied(false)
    try { const r = await callFunction<{ link: string }>('admin', { action: 'invite', email }); setLink({ email, url: r.link }); setEmail(''); loadPeople(); loadPanel() } catch (e) { setErr(msg(e)) }
    setBusy('')
  }
  const copy = async () => { try { await navigator.clipboard.writeText(link!.url); setCopied(true) } catch { /* o campo continua selecionável */ } }
  const settings = (changes: Record<string, unknown>) => rpc('admin_set_settings', { changes })

  if (!admin) return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link to="/config" className="row caption muted" style={{ gap: 4, alignSelf: 'flex-start' }}><Icon name="back" size={16} />Configurações</Link>
      <p className="muted">Esta página é só para quem administra o app.</p>
    </div>
  )

  const testers = new Set(panel?.testers ?? [])
  const s = panel?.settings
  const today = new Date().toISOString().slice(0, 10)
  const live = s?.announcement && (!s.announcement_until || s.announcement_until >= today)
  const draft = notice ?? { text: s?.announcement ?? '', until: s?.announcement_until ?? '' }
  const active = people?.filter((p) => !p.blocked) ?? []
  const blocked = people?.filter((p) => p.blocked) ?? []
  const row = (p: Person) => (
    <button key={p.id} className="list-row" onClick={() => !p.admin && setOpen(p)} disabled={p.admin}>
      <span className="avatar">{(p.name || p.email).charAt(0).toUpperCase()}</span>
      <span className="grow stack" style={{ gap: 0, textAlign: 'left', minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || p.email}{p.admin && <span className="caption muted"> · você</span>}</span>
        <span className="caption muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.name ? `${p.email} · ` : ''}{p.blocked ? 'bloqueada' : p.pending ? `convite enviado ${ago(p.created_at)}, ainda não entrou` : p.last_sign_in_at ? `entrou ${ago(p.last_sign_in_at)}` : ''}
        </span>
      </span>
      {testers.has(p.id) && <span className="tag-pill lime">testadora</span>}
      {p.pending && !p.blocked && <span className="tag-pill">convite pendente</span>}
      {!p.admin && <Icon name="chevron" size={16} className="faint" />}
    </button>
  )

  return (
    <div className="page painel" style={{ maxWidth: 1040 }}>
      <Link to="/config" className="row caption muted" style={{ gap: 4, alignSelf: 'flex-start' }}><Icon name="back" size={16} />Configurações</Link>
      <span className="owner-pill"><Icon name="lock" size={13} />Só a dona do app vê isto</span>
      <PageHeader title="Painel do app" />
      <p className="muted" style={{ margin: '-8px 0 0' }}>Pessoas, recursos em teste, padrões e avisos. Fica ligado à sua conta e não aparece para mais ninguém.</p>
      {err && <p role="alert" className="banner" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}

      <span className="mono muted">Visão geral</span>
      <div className="painel-stats">
        {[[panel?.people ?? people?.length, 'pessoas com conta'], [panel?.active_week, 'usaram esta semana'], [panel?.invites_open, 'convites abertos'], [fmt(new Date(__BUILD__), 'd MMM'), 'versão publicada']].map(([v, l]) => (
          <div key={String(l)} className="card stack" style={{ gap: 0 }}><span className="big mono">{v ?? '–'}</span><span className="caption muted">{l}</span></div>
        ))}
      </div>

      <div className="painel-grid">
        <div className="stack">
          <span className="mono muted">Pessoas{people ? ` · ${active.length}` : ''}</span>
          <div className="card stack">
            <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (email) invite() }}>
              <input className="input grow" style={{ minWidth: 180 }} type="email" required maxLength={254} placeholder="email@da.pessoa" aria-label="E-mail de quem convidar" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
              <button className="btn primary" disabled={busy === 'invite' || !email}>{busy === 'invite' ? 'Criando…' : 'Convidar'}</button>
            </form>
            {link ? (
              <div className="stack" style={{ gap: 6 }}>
                <span className="caption">Convite para <b>{link.email}</b>. Mande este link só para essa pessoa. Ele entra direto na conta dela e vale por pouco tempo; se expirar, apague e convide de novo.</span>
                <div className="row" style={{ gap: 8 }}>
                  <input className="input grow mono" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Link do convite" />
                  <button type="button" className="btn secondary" onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</button>
                </div>
              </div>
            ) : <span className="caption muted">Só entra quem você convida. Toque numa pessoa para dar acesso antecipado, bloquear ou apagar.</span>}
          </div>
          <div className="card flush list">
            {people === null ? <div className="list-row caption muted">Carregando…</div> : active.map(row)}
          </div>
          {blocked.length > 0 && <>
            <span className="mono muted">Bloqueadas · {blocked.length}</span>
            <div className="card flush list">{blocked.map(row)}</div>
          </>}

          <span className="mono muted">Aviso para todos</span>
          <div className="card stack">
            {live ? <span className="caption">No ar agora{s?.announcement_until ? ` até ${fmt(new Date(s.announcement_until + 'T12:00'), 'd MMM')}` : ''}: “{s?.announcement}”</span>
              : <span className="caption muted">Uma mensagem curta no topo do app de todo mundo. Cada pessoa pode fechar.</span>}
            <label className="field"><span>Texto do aviso</span>
              <textarea className="input" rows={2} maxLength={280} placeholder="Domingo às 22h o app fica fora do ar por 10 minutos." value={draft.text} onChange={(e) => setNotice({ ...draft, text: e.target.value })} /></label>
            <label className="field"><span>Mostrar até (opcional)</span>
              <input className="input" type="date" min={today} value={draft.until} onChange={(e) => setNotice({ ...draft, until: e.target.value })} /></label>
            <div className="row" style={{ gap: 8 }}>
              {live && <button className="btn secondary grow" disabled={!!busy} onClick={() => run('notice', async () => { await settings({ announcement: '', announcement_until: '' }); setNotice(null) })}>Tirar do ar</button>}
              <button className="btn primary grow" disabled={!!busy || !draft.text.trim()} onClick={() => run('notice', async () => { await settings({ announcement: draft.text, announcement_until: draft.until }); setNotice(null) })}>{busy === 'notice' ? 'Publicando…' : 'Publicar aviso'}</button>
            </div>
          </div>
        </div>

        <div className="stack">
          <span className="mono muted">Recursos em teste</span>
          <div className="card stack" style={{ gap: 14 }}>
            <span className="caption muted">Cada recurso novo começa só com você. Depois passa para quem testa e, por fim, para todos.</span>
            {FEATURES.map((f) => {
              const level = panel?.flags[f.key]
              return (
                <div key={f.key} className="stack" style={{ gap: 8 }}>
                  <div className="stack" style={{ gap: 0 }}><span className="medium">{f.name}</span><span className="caption muted">{f.hint}</span></div>
                  <div className="dur-options" role="radiogroup" aria-label={`Quem tem ${f.name}`}>
                    {LEVELS.map(([k, l]) => (
                      <button key={k} type="button" role="radio" aria-checked={level === k} disabled={!panel || !!busy} className={'dur-opt small' + (level === k ? (k === 'all' ? ' on lime' : ' on') : '')}
                        onClick={() => run('flag', () => rpc('admin_set_flag', { flag: f.key, level: k }))}>{l}</button>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <span className="mono muted">Padrões para todos</span>
          <div className="card stack" style={{ gap: 8 }}>
            <div className="stack" style={{ gap: 0 }}><span className="medium">Duração de um ciclo novo</span><span className="caption muted">O que já vem marcado quando alguém cria um ciclo.</span></div>
            <div className="dur-options" role="radiogroup" aria-label="Duração padrão do ciclo">
              {[8, 12].map((w) => <button key={w} type="button" role="radio" aria-checked={s?.default_weeks === w} disabled={!panel || !!busy} className={'dur-opt mono' + (s?.default_weeks === w ? ' on' : '')} onClick={() => run('weeks', () => settings({ default_weeks: w }))}>{w} semanas</button>)}
            </div>
          </div>

          <span className="mono muted">Saúde do app</span>
          <div className="card flush list">
            <div className="list-row"><span className={'dot' + (panel ? ' ok' : '')} /><span className="grow">Notificações enviadas hoje</span><span className="mono">{panel?.notifications_today ?? '–'}</span></div>
            <div className="list-row"><span className={'dot' + (panel && panel.sync_errors === 0 ? ' ok' : panel ? ' bad' : '')} /><span className="grow">Agendas com erro de sincronização</span><span className="mono">{panel?.sync_errors ?? '–'}</span></div>
            <div className="list-row"><span className={'dot' + (panel ? ' ok' : '')} /><span className="grow stack" style={{ gap: 0 }}><span>Mudanças esperando sincronizar</span>{panel?.last_sync && <span className="caption muted">última sincronização {ago(panel.last_sync)}</span>}</span><span className="mono">{panel?.sync_pending ?? '–'}</span></div>
            <div className="list-row">
              <span className="grow stack" style={{ gap: 0 }}><span>Modo manutenção</span><span className="caption muted">Mostra uma tela de pausa para todos menos você.</span></span>
              <Toggle on={!!s?.maintenance} label="Modo manutenção" onChange={(v) => { if (!v || window.confirm('Ligar o modo manutenção? As outras pessoas deixam de conseguir usar o app até você desligar.')) run('maint', () => settings({ maintenance: v })) }} />
            </div>
            <div className="list-row">
              <span className="grow stack" style={{ gap: 0 }}><span>Pedir atualização</span><span className="caption muted">{s?.refresh_after ? `Último pedido ${ago(s.refresh_after)}. ` : ''}Quem estiver numa versão antiga vê um aviso para atualizar.</span></span>
              <button className="btn secondary small" disabled={!!busy} onClick={() => run('refresh', () => settings({ refresh: true }))}>{busy === 'refresh' ? '…' : 'Pedir'}</button>
            </div>
          </div>
        </div>
      </div>

      <p className="caption faint row" style={{ margin: 0 }}><Icon name="shield" size={16} />Você vê nomes, e-mails e números do app. Nunca vê finanças, metas ou reflexões de ninguém.</p>

      <Sheet open={!!open} onClose={() => setOpen(null)} labelledBy="admin-person">
        {open && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="stack" style={{ gap: 2 }}>
              <h2 id="admin-person" className="h2">{open.name || open.email}</h2>
              <span className="caption muted">{open.email} · conta criada {ago(open.created_at)}{open.last_sign_in_at ? ` · entrou ${ago(open.last_sign_in_at)}` : ' · ainda não entrou'}</span>
            </div>
            {!open.blocked && (
              <div className="row" style={{ gap: 12 }}>
                <span className="grow stack" style={{ gap: 0 }}><span className="medium">Acesso antecipado</span><span className="caption muted">Recebe os recursos marcados como “Testadores”.</span></span>
                <Toggle on={testers.has(open.id)} label="Acesso antecipado" onChange={(v) => run('tester', () => rpc('admin_set_tester', { person: open.id, tester: v }))} />
              </div>
            )}
            {!open.blocked ? (
              <>
                <p className="caption" style={{ margin: 0 }}>Bloquear impede a pessoa de entrar. Nada é apagado e você pode desbloquear quando quiser. Se ela estiver com o app aberto, sai em até 1 hora.</p>
                <button className="btn secondary block" disabled={!!busy} onClick={() => act('block', open)}>{busy === 'block' ? 'Bloqueando…' : 'Bloquear'}</button>
              </>
            ) : (
              <>
                <button className="btn primary block" disabled={!!busy} onClick={() => act('unblock', open)}>{busy === 'unblock' ? 'Desbloqueando…' : 'Desbloquear'}</button>
                <div className="stack" style={{ gap: 6, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  <span className="medium" style={{ color: 'var(--danger)' }}>Apagar de vez</span>
                  <p className="caption" style={{ margin: 0 }}>Apaga a conta e tudo o que a pessoa guardou no app: metas, tarefas, finanças, reflexões, agenda. Ela sai dos grupos. Não dá para desfazer.</p>
                  <button className="btn block" style={{ color: 'var(--danger)', boxShadow: 'inset 0 0 0 1px var(--danger)' }} disabled={!!busy}
                    onClick={() => { if (window.confirm(`Apagar de vez a conta de ${open.email} e todos os dados dela? Não dá para desfazer.`)) act('delete', open) }}>
                    {busy === 'delete' ? 'Apagando…' : 'Apagar conta e dados'}
                  </button>
                </div>
              </>
            )}
            {err && <p role="alert" className="caption" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}
          </div>
        )}
      </Sheet>
    </div>
  )
}
