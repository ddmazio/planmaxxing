import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { DEMO, callFunction, rpc } from '../lib/db'
import { Icon } from '../components/Icon'
import { PageHeader } from '../components/Shell'
import { Sheet } from '../components/ui'

export interface Person {
  id: string; email: string; name: string | null; created_at: string; last_sign_in_at: string | null
  blocked: boolean; pending: boolean; admin: boolean
}

/** A conta logada é dona do app? (o servidor confere de novo em toda ação) */
export function useIsAdmin() {
  const [admin, setAdmin] = useState(false)
  useEffect(() => { if (!DEMO) rpc<boolean>('am_i_admin', {}).then((v) => setAdmin(v === true)).catch(() => setAdmin(false)) }, [])
  return admin
}

const ago = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR })

export function ConfigAdmin() {
  const admin = useIsAdmin()
  const [people, setPeople] = useState<Person[] | null>(null)
  const [err, setErr] = useState('')
  const [email, setEmail] = useState('')
  const [link, setLink] = useState<{ email: string; url: string } | null>(null)
  const [busy, setBusy] = useState('')
  const [open, setOpen] = useState<Person | null>(null)
  const [copied, setCopied] = useState(false)

  const load = useCallback(async () => {
    try { setPeople((await callFunction<{ people: Person[] }>('admin', { action: 'list' })).people) } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
  }, [])
  useEffect(() => { if (admin) load() }, [admin, load])

  const act = async (action: 'block' | 'unblock' | 'delete', p: Person) => {
    setBusy(action); setErr('')
    try { await callFunction('admin', { action, id: p.id }); setOpen(null); await load() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  const invite = async () => {
    setBusy('invite'); setErr(''); setLink(null); setCopied(false)
    try { const r = await callFunction<{ link: string }>('admin', { action: 'invite', email }); setLink({ email, url: r.link }); setEmail(''); load() } catch (e) { setErr(e instanceof Error ? e.message : String(e)) }
    setBusy('')
  }
  const copy = async () => { try { await navigator.clipboard.writeText(link!.url); setCopied(true) } catch { /* o campo continua selecionável */ } }

  if (!admin) return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link to="/config" className="row caption muted" style={{ gap: 4, alignSelf: 'flex-start' }}><Icon name="back" size={16} />Configurações</Link>
      <p className="muted">Esta página é só para quem administra o app.</p>
    </div>
  )

  const active = people?.filter((p) => !p.blocked) ?? []
  const blocked = people?.filter((p) => p.blocked) ?? []
  const row = (p: Person) => (
    <button key={p.id} className="list-row" onClick={() => !p.admin && setOpen(p)} disabled={p.admin}>
      <Icon name={p.admin ? 'star' : p.blocked ? 'lock' : 'users'} />
      <span className="grow stack" style={{ gap: 0, textAlign: 'left', minWidth: 0 }}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name || p.email}{p.admin && <span className="caption muted"> · você</span>}</span>
        <span className="caption muted" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {p.name ? `${p.email} · ` : ''}{p.blocked ? 'bloqueada' : p.pending ? `convite enviado ${ago(p.created_at)}, ainda não entrou` : p.last_sign_in_at ? `entrou ${ago(p.last_sign_in_at)}` : ''}
        </span>
      </span>
      {!p.admin && <Icon name="chevron" size={16} className="faint" />}
    </button>
  )

  return (
    <div className="page" style={{ maxWidth: 720 }}>
      <Link to="/config" className="row caption muted" style={{ gap: 4, alignSelf: 'flex-start' }}><Icon name="back" size={16} />Configurações</Link>
      <PageHeader eyebrow="Dona do app" title="Administração" />
      <p className="muted" style={{ margin: '-8px 0 0' }}>O app é só para convidados. Aqui você vê quem tem conta, convida, bloqueia e apaga. Os dados das pessoas (metas, finanças, reflexões) não aparecem aqui.</p>

      <span className="mono muted">Convidar</span>
      <div className="card stack">
        <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (email) invite() }}>
          <input className="input grow" style={{ minWidth: 200 }} type="email" required maxLength={254} placeholder="email@da.pessoa" aria-label="E-mail de quem convidar" value={email} onChange={(e) => setEmail(e.target.value.trim())} />
          <button className="btn primary" disabled={busy === 'invite' || !email}>{busy === 'invite' ? 'Criando…' : 'Criar convite'}</button>
        </form>
        {link ? (
          <div className="stack" style={{ gap: 6 }}>
            <span className="caption">Convite para <b>{link.email}</b>. Mande este link só para essa pessoa (WhatsApp, e-mail). Ele entra direto na conta dela e vale por pouco tempo; se expirar, apague e convide de novo.</span>
            <div className="row" style={{ gap: 8 }}>
              <input className="input grow mono" readOnly value={link.url} onFocus={(e) => e.target.select()} aria-label="Link do convite" />
              <button type="button" className="btn secondary" onClick={copy}>{copied ? 'Copiado' : 'Copiar'}</button>
            </div>
            <span className="caption muted">Ela também pode entrar com o Google, se usar este mesmo e-mail.</span>
          </div>
        ) : <span className="caption muted">O app cria um link de entrada só para esse e-mail. Quem não foi convidada não consegue criar conta.</span>}
      </div>

      {err && <p role="alert" className="caption" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}

      <span className="mono muted">Pessoas{people ? ` · ${active.length}` : ''}</span>
      <div className="card flush list">
        {people === null ? <div className="list-row caption muted">Carregando…</div> : active.map(row)}
      </div>
      {blocked.length > 0 && <>
        <span className="mono muted">Bloqueadas · {blocked.length}</span>
        <div className="card flush list">{blocked.map(row)}</div>
      </>}

      <Sheet open={!!open} onClose={() => setOpen(null)} labelledBy="admin-person">
        {open && (
          <div className="stack" style={{ gap: 14 }}>
            <div className="stack" style={{ gap: 2 }}>
              <h2 id="admin-person" className="h2">{open.name || open.email}</h2>
              <span className="caption muted">{open.email} · conta criada {ago(open.created_at)}{open.last_sign_in_at ? ` · entrou ${ago(open.last_sign_in_at)}` : ' · ainda não entrou'}</span>
            </div>
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
