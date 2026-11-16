import { useState } from 'react'
import { DEMO } from '../lib/db'
import { useAuth } from '../lib/auth'

const INVITE_ONLY = 'Este app é só para convidados. Peça um convite a quem te chamou e use o mesmo e-mail do convite.'
function reason(msg: string) {
  if (/signups? not allowed|not allowed for otp|user not found/i.test(msg)) return INVITE_ONLY
  if (/banned/i.test(msg)) return 'Esta conta está bloqueada. Fale com quem administra o app.'
  return 'Não deu certo. Confira e tente de novo.'
}

export function Login() {
  const { signInGoogle, signInEmail, startDemo } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)

  // a volta do Google com erro (ex.: conta não convidada ou bloqueada) chega no endereço
  const [err, setErr] = useState<string | null>(() => {
    const q = new URLSearchParams(window.location.search + '&' + window.location.hash.slice(1))
    return q.get('error') ? reason(q.get('error_description') ?? q.get('error') ?? '') : null
  })
  const run = async (fn: () => Promise<void>) => {
    setErr(null); setBusy(true)
    try { await fn() } catch (e) { setErr(reason(e instanceof Error ? e.message : '')) } finally { setBusy(false) }
  }

  return (
    <div style={{ minHeight: '100%', display: 'grid', placeItems: 'center', padding: 24, background: 'linear-gradient(180deg, var(--lime-soft), var(--bg-canvas) 60%)' }}>
      <div className="stack" style={{ width: '100%', maxWidth: 420, gap: 20 }}>
        <div className="brand" style={{ padding: 0 }}><span className="brand-mark">db</span>Dream Board</div>
        <h1 className="serif" style={{ fontSize: 48, lineHeight: '50px', margin: 0 }}>Um ano cabe em 12 semanas.</h1>
        <p className="muted" style={{ margin: 0 }}>Planeje por ciclos, acompanhe a semana e cresça junto com quem você ama.</p>
        {DEMO ? (
          <>
            <div className="banner">Este app ainda não está ligado a um servidor. Você pode testar tudo no modo demonstração: os dados ficam só neste aparelho.</div>
            <button className="btn primary block" disabled={busy} onClick={() => run(startDemo)}>Testar no modo demonstração</button>
          </>
        ) : sent ? (
          <div className="card stack"><b>Confira o seu e-mail</b><span className="muted caption">Mandamos um link para {email}. Ele vale por 1 hora e só funciona uma vez.</span></div>
        ) : (
          <>
            <button className="btn primary block" disabled={busy} onClick={() => run(signInGoogle)}>Continuar com Google</button>
            <form className="stack" onSubmit={(e) => { e.preventDefault(); if (/^\S+@\S+\.\S+$/.test(email)) run(async () => { await signInEmail(email); setSent(true) }) }}>
              <label className="field"><span>Ou receba um link no e-mail</span>
                <input className="input" type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value.trim())} placeholder="voce@email.com" />
              </label>
              <button className="btn secondary block" disabled={busy}>Enviar link</button>
            </form>
          </>
        )}
        {err && <p role="alert" className="caption" style={{ color: 'var(--danger)', margin: 0 }}>{err}</p>}
        <p className="caption faint" style={{ margin: 0 }}>Sem senha para vazar: o acesso é pelo Google ou por um link de uso único. Seus dados ficam em servidores na União Europeia.</p>
      </div>
    </div>
  )
}
