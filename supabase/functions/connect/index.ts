// Dream Board · função "connect"
// POST (com o login da pessoa): devolve o endereço de autorização do Google ou da Microsoft.
// GET (volta do Google/Microsoft): troca o código pela chave permanente, guarda no Vault e volta ao app.
import { makeDb, projectKeys } from '../_shared/rest.ts'
import { GOOGLE_SCOPE } from '../_shared/google.ts'
import { MS_SCOPE } from '../_shared/microsoft.ts'
import { signState, verifyState } from '../_shared/state.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const KEYS = projectKeys(env)
const KEY = KEYS.service
const db = makeDb(SUPABASE_URL, KEY)
const APP = env('APP_URL') || 'https://planmaxxing.vercel.app'
const REDIRECT = `${SUPABASE_URL}/functions/v1/connect`
const ORIGINS = ['https://planmaxxing.vercel.app', 'http://localhost:5173']

const cors = (req: Request) => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(req.headers.get('Origin') ?? '') ? req.headers.get('Origin')! : ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin',
})
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } })
const back = (q: string) => new Response(null, { status: 302, headers: { Location: `${APP}/config?${q}`, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } })

async function userOf(req: Request) {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEYS.anon, Authorization: auth } })
  return r.ok ? ((await r.json()) as { id: string }) : null
}

function authUrl(provider: 'google' | 'microsoft', state: string) {
  if (provider === 'google') {
    return 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'), redirect_uri: REDIRECT, response_type: 'code', scope: GOOGLE_SCOPE,
      access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state,
    })
  }
  return 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?' + new URLSearchParams({
    client_id: env('MS_CLIENT_ID'), redirect_uri: REDIRECT, response_type: 'code', response_mode: 'query', scope: MS_SCOPE, prompt: 'select_account', state,
  })
}

async function exchange(provider: 'google' | 'microsoft', code: string) {
  if (provider === 'google') {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
    })
    const j = await r.json()
    if (!r.ok || !j.refresh_token) throw new Error(j.error ?? 'sem chave permanente')
    if (!String(j.scope ?? '').includes('calendar.readonly')) throw new Error('permissão da agenda não marcada')
    let email: string | null = null
    try { email = JSON.parse(atob(j.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email ?? null } catch { /* sem e-mail */ }
    return { refresh: j.refresh_token as string, email }
  }
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: env('MS_CLIENT_ID'), client_secret: env('MS_CLIENT_SECRET'), redirect_uri: REDIRECT, grant_type: 'authorization_code', scope: MS_SCOPE }),
  })
  const j = await r.json()
  if (!r.ok || !j.refresh_token) throw new Error(j.error_description?.slice(0, 120) ?? j.error ?? 'sem chave permanente')
  const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName', { headers: { Authorization: `Bearer ${j.access_token}` } })
  const mj = me.ok ? await me.json() : {}
  return { refresh: j.refresh_token as string, email: (mj.mail || mj.userPrincipalName || null) as string | null }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) })
  const url = new URL(req.url)

  if (req.method === 'GET') {
    const st = await verifyState(KEY, url.searchParams.get('state') ?? '')
    if (!st) return back('conexao=erro&motivo=expirou')
    const provider = st.p as 'google' | 'microsoft'
    if (url.searchParams.get('error')) return back(`conexao=erro&servico=${provider}&motivo=cancelado`)
    try {
      const { refresh, email } = await exchange(provider, url.searchParams.get('code') ?? '')
      await db.rpc('integration_save', { p_owner: st.u, p_provider: provider, p_email: email, p_token: refresh })
      // primeira sincronização já, sem esperar o próximo ciclo
      await db.rpc('sync_ping', { p_owner: st.u }).catch(() => {})
      return back(`conectado=${provider}`)
    } catch (e) {
      console.error('connect', provider, (e as Error).message)
      return back(`conexao=erro&servico=${provider}&motivo=${encodeURIComponent((e as Error).message.slice(0, 80))}`)
    }
  }

  if (req.method === 'POST') {
    const user = await userOf(req)
    if (!user) return json(req, 401, { error: 'login' })
    const { provider } = await req.json().catch(() => ({})) as { provider?: string }
    if (provider !== 'google' && provider !== 'microsoft') return json(req, 400, { error: 'provider' })
    if (!env(provider === 'google' ? 'GOOGLE_CLIENT_ID' : 'MS_CLIENT_ID')) return json(req, 500, { error: 'Falta configurar as chaves do servidor.' })
    return json(req, 200, { url: authUrl(provider, await signState(KEY, user.id, provider)) })
  }
  return json(req, 405, { error: 'method' })
})
