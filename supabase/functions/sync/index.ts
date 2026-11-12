// Dream Board · função "sync"
// Chamada pelo banco a cada 2 minutos (e logo depois de mudanças nas tarefas) com uma senha interna,
// ou pelo app, com o login da pessoa, no botão "Sincronizar agora".
import { makeDb, projectKeys } from '../_shared/rest.ts'
import { refreshGoogle } from '../_shared/google.ts'
import { refreshMicrosoft } from '../_shared/microsoft.ts'
import { type MsState, syncGoogle, syncMicrosoft } from '../_shared/core.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const KEYS = projectKeys(env)
const db = makeDb(SUPABASE_URL, KEYS.service)
const ORIGINS = ['https://planmaxxing.vercel.app', 'http://localhost:5173']

const cors = (req: Request) => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(req.headers.get('Origin') ?? '') ? req.headers.get('Origin')! : ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin',
})
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...cors(req) } })

async function userOf(req: Request) {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEYS.anon, Authorization: auth } })
  return r.ok ? ((await r.json()) as { id: string }) : null
}

interface Integ { owner_id: string; provider: 'google' | 'microsoft'; status: string; state: MsState; last_sync_at: string | null; last_full_sync_at: string | null }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method' })
  const body = await req.json().catch(() => ({})) as { owner?: string; provider?: string }

  let owners: string[] | null = null
  let manual = false
  const secret = req.headers.get('x-sync-secret')
  if (secret) {
    if (!(await db.rpc<boolean>('sync_secret_ok', { p_secret: secret }))) return json(req, 401, { error: 'secret' })
    if (body.owner && /^[0-9a-f-]{36}$/.test(body.owner)) owners = [body.owner]
  } else {
    const user = await userOf(req)
    if (!user) return json(req, 401, { error: 'login' })
    owners = [user.id]; manual = true
  }

  const filter = owners ? `&owner_id=in.(${owners.join(',')})` : ''
  const provider = body.provider === 'google' || body.provider === 'microsoft' ? `&provider=eq.${body.provider}` : ''
  const integs = await db.get<Integ[]>(`integrations?select=owner_id,provider,status,state,last_sync_at,last_full_sync_at${filter}${provider}`)
  const report: Record<string, unknown>[] = []

  for (const it of integs) {
    const since = it.last_sync_at ? Date.now() - Date.parse(it.last_sync_at) : Infinity
    if (!manual && it.provider === 'google' && since < 14 * 60000) continue
    if (!manual && it.status === 'error' && since < 60 * 60000) continue
    if (!(await db.rpc<boolean>('sync_lease', { p_owner: it.owner_id, p_provider: it.provider, p_seconds: 140 }))) continue
    const where = `integrations?owner_id=eq.${it.owner_id}&provider=eq.${it.provider}`
    try {
      const [p] = await db.get<{ timezone: string }[]>(`profiles?select=timezone&id=eq.${it.owner_id}`)
      const tz = p?.timezone || 'Europe/Lisbon'
      const token = await db.rpc<string | null>('integration_token', { p_owner: it.owner_id, p_provider: it.provider })
      if (!token) throw new Error('Sem chave guardada. Ligue de novo em Configurações.')
      if (it.provider === 'google') {
        const access = await refreshGoogle(env('GOOGLE_CLIENT_ID'), env('GOOGLE_CLIENT_SECRET'), token)
        const r = await syncGoogle(db, it.owner_id, tz, access, it, manual)
        await db.patch(where, { last_sync_at: new Date().toISOString(), ...(r.full ? { last_full_sync_at: new Date().toISOString() } : {}), status: 'active', last_error: null })
        report.push({ provider: 'google', ...r })
      } else {
        const { access, refresh } = await refreshMicrosoft(env('MS_CLIENT_ID'), env('MS_CLIENT_SECRET'), token)
        if (refresh !== token) await db.rpc('integration_save', { p_owner: it.owner_id, p_provider: 'microsoft', p_email: null, p_token: refresh })
        const state = { ...(it.state ?? {}) }
        const r = await syncMicrosoft(db, it.owner_id, tz, access, state)
        await db.patch(where, { state, last_sync_at: new Date().toISOString(), status: 'active', last_error: null })
        report.push({ provider: 'microsoft', ...r })
      }
    } catch (e) {
      const msg = (e as Error).message.slice(0, 1000)
      console.error(it.provider, msg)
      await db.patch(where, { status: 'error', last_error: msg }).catch(() => {})
      report.push({ provider: it.provider, error: msg })
    } finally {
      await db.rpc('sync_lease', { p_owner: it.owner_id, p_provider: it.provider, p_seconds: 0 }).catch(() => {})
    }
  }
  return json(req, 200, { ok: true, report: manual ? report : undefined })
})
