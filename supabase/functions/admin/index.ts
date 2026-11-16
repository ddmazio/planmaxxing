/**
 * Dream Board · função "admin": só a dona do app (tabela app_admins) usa.
 * Lista as contas (sem os dados delas), cria convites, bloqueia, desbloqueia e apaga.
 * Toda ação confere de novo, no servidor, se quem pede é admin.
 */
import { makeDb, projectKeys } from '../_shared/rest.ts'
import { type AuthUser, inviteError, toPerson } from '../_shared/admin.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const KEYS = projectKeys(env)
const db = makeDb(SUPABASE_URL, KEYS.service)
const APP = env('APP_URL') || 'https://twelvefold-app.vercel.app'
const ORIGINS = ['https://twelvefold-app.vercel.app', 'https://planmaxxing.vercel.app', 'http://localhost:5173']
const BAN = '876000h' // ~100 anos: bloqueado até desbloquear

const cors = (req: Request) => ({
  'Access-Control-Allow-Origin': ORIGINS.includes(req.headers.get('Origin') ?? '') ? req.headers.get('Origin')! : ORIGINS[0],
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
})
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors(req) } })

const authHeaders = (): Record<string, string> => KEYS.service.startsWith('sb_')
  ? { apikey: KEYS.service, 'Content-Type': 'application/json' }
  : { apikey: KEYS.service, Authorization: `Bearer ${KEYS.service}`, 'Content-Type': 'application/json' }
async function gotrue<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, { method, headers: authHeaders(), body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await r.text()
  if (!r.ok) { const e = new Error(t.slice(0, 300)) as Error & { status: number }; e.status = r.status; throw e }
  return (t ? JSON.parse(t) : null) as T
}

async function userOf(req: Request): Promise<{ id: string } | null> {
  const auth = req.headers.get('Authorization')
  if (!auth) return null
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: KEYS.anon, Authorization: auth } })
  return r.ok ? await r.json() : null
}
const isAdmin = async (id: string) => (await db.get<unknown[]>(`app_admins?select=user_id&user_id=eq.${id}`)).length > 0
const UUID = /^[0-9a-f-]{36}$/

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method' })
  const me = await userOf(req)
  if (!me) return json(req, 401, { error: 'login' })
  if (!(await isAdmin(me.id))) return json(req, 403, { error: 'Só a dona do app pode fazer isso.' })

  const body = await req.json().catch(() => ({})) as { action?: string; email?: string; id?: string }
  try {
    if (body.action === 'list') {
      const users: AuthUser[] = []
      for (let page = 1; page <= 10; page++) {
        const r = await gotrue<{ users: AuthUser[] }>('GET', `users?page=${page}&per_page=200`)
        users.push(...r.users)
        if (r.users.length < 200) break
      }
      const admins = new Set((await db.get<{ user_id: string }[]>('app_admins?select=user_id')).map((a) => a.user_id))
      const names = new Map((await db.getAll<{ id: string; display_name: string | null }>('profiles?select=id,display_name')).map((p) => [p.id, p.display_name]))
      const people = users.map((u) => toPerson(u, names.get(u.id) ?? null, admins.has(u.id)))
        .sort((a, b) => Number(b.admin) - Number(a.admin) || b.created_at.localeCompare(a.created_at))
      return json(req, 200, { people })
    }

    if (body.action === 'invite') {
      const email = String(body.email ?? '').trim().toLowerCase()
      if (!/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(email)) return json(req, 400, { error: 'Confira o e-mail.' })
      try {
        const r = await gotrue<{ action_link?: string; properties?: { action_link?: string } }>('POST', 'generate_link', { type: 'invite', email, redirect_to: APP })
        const link = r.action_link ?? r.properties?.action_link
        if (!link) throw new Error('sem link')
        return json(req, 200, { link })
      } catch (e) {
        return json(req, 400, { error: inviteError((e as Error).message) })
      }
    }

    if (body.action === 'block' || body.action === 'unblock' || body.action === 'delete') {
      const id = String(body.id ?? '')
      if (!UUID.test(id)) return json(req, 400, { error: 'id' })
      if (id === me.id || (await isAdmin(id))) return json(req, 400, { error: 'Não dá para fazer isso com a conta de quem administra o app.' })
      if (body.action === 'delete') {
        // segurança extra: só apaga quem já está bloqueado
        const u = await gotrue<AuthUser>('GET', `users/${id}`)
        if (!toPerson(u, null, false).blocked) return json(req, 400, { error: 'Bloqueie a conta antes de apagar.' })
        await gotrue('DELETE', `users/${id}`)
        return json(req, 200, { ok: true })
      }
      await gotrue('PUT', `users/${id}`, { ban_duration: body.action === 'block' ? BAN : 'none' })
      return json(req, 200, { ok: true })
    }
    return json(req, 400, { error: 'action' })
  } catch (e) {
    console.error('admin', body.action, (e as Error).message)
    return json(req, 500, { error: 'Não deu certo agora. Tente de novo em instantes.' })
  }
})
