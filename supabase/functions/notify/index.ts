// Dream Board · função "notify"
// Chamada pelo banco a cada 5 minutos (senha interna) para mandar os avisos que estão na hora.
// Pelo app, com o login da pessoa: {action: 'init'} prepara as chaves, {action: 'test'} manda um aviso de teste.
import { makeDb, projectKeys } from '../_shared/rest.ts'
import { type Vapid, newVapid, sendPush } from '../_shared/webpush.ts'
import { type Data, type Person, due } from '../_shared/notify.ts'

const env = (k: string) => Deno.env.get(k) ?? ''
const SUPABASE_URL = env('SUPABASE_URL')
const KEYS = projectKeys(env)
const db = makeDb(SUPABASE_URL, KEYS.service)
const APP = env('APP_URL') || 'https://planmaxxing.vercel.app'
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

/** Chaves VAPID: na primeira vez, gera aqui e guarda no Vault. A privada nunca sai do servidor. */
async function vapid(): Promise<Vapid> {
  const raw = await db.rpc<string | null>('push_vapid', {})
  if (raw) return JSON.parse(raw)
  await db.rpc('push_vapid_init', { p_value: JSON.stringify(await newVapid(APP)) })
  return JSON.parse((await db.rpc<string>('push_vapid', {}))!)
}

interface SubRow { id: string; owner_id: string; endpoint: string; p256dh: string; auth: string }
const inList = (ids: string[]) => `in.(${ids.join(',')})`

/** Guarda “já avisei” antes de mandar; devolve false se outro disparo já tinha mandado. */
async function claim(owner: string, kind: string, key: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/notify_log?on_conflict=owner_id,kind,key`, {
    method: 'POST',
    headers: { apikey: KEYS.service, ...(KEYS.service.startsWith('sb_') ? {} : { Authorization: `Bearer ${KEYS.service}` }), 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({ owner_id: owner, kind, key }),
  })
  return r.ok && ((await r.json()) as unknown[]).length > 0
}

async function deliver(subs: SubRow[], msg: { title: string; body?: string; url: string; tag?: string }, v: Vapid) {
  let sent = 0
  for (const s of subs) {
    try {
      const st = await sendPush(s, msg, v)
      if (st === 404 || st === 410) await db.del(`push_subscriptions?id=eq.${s.id}`)
      else if (st < 300) sent++
      else console.error('push', st, new URL(s.endpoint).host)
    } catch (e) { console.error('push', (e as Error).message) }
  }
  return sent
}

async function gather(owners: string[]): Promise<{ people: Person[]; data: Data }> {
  const now = Date.now()
  const since = new Date(now - 15 * 60000).toISOString()
  const until = new Date(now + 26 * 3600e3).toISOString()
  const O = inList(owners)
  const people = await db.get<Person[]>(`profiles?select=id,timezone,notify&id=${O}`)
  const cycles = await db.get<{ id: string; owner_id: string; starts_on: string }[]>(`cycles?select=id,owner_id,starts_on&status=eq.active&owner_id=${O}&order=starts_on.desc`)
  const cyc = owners.map((o) => cycles.find((c) => c.owner_id === o)).filter(Boolean) as typeof cycles
  const goals = cyc.length ? await db.get<{ id: string; owner_id: string; cycle_id: string }[]>(`goals?select=id,owner_id,cycle_id&cycle_id=${inList(cyc.map((c) => c.id))}`) : []
  const stepRows = goals.length ? await db.getAll<{ goal_id: string; week: number; done_at: string | null }>(`steps?select=goal_id,week,done_at&goal_id=${inList(goals.map((g) => g.id))}`) : []
  const habits = await db.get<Data['habits']>(`habits?select=id,owner_id,title,days,reminder_time&archived=eq.false&owner_id=${O}`)
  const events = await db.get<Data['events']>(`events?select=id,owner_id,title,starts_at,all_day,reminder_minutes&owner_id=${O}&starts_at=gte.${since}&starts_at=lt.${until}&order=starts_at`)
  const tasks = await db.get<Data['tasks']>(`tasks?select=id,owner_id,title,remind_at&completed_at=is.null&owner_id=${O}&remind_at=gte.${since}&remind_at=lte.${new Date(now).toISOString()}`)
  const gm = await db.get<{ user_id: string; group_id: string; share: string; groups: { name: string; checkin_weekday: number } }[]>(`group_members?select=user_id,group_id,share,groups(name,checkin_weekday)&user_id=${O}`)
  const groupIds = [...new Set(gm.map((g) => g.group_id))]
  const cheersRaw = await db.get<{ id: string; to_id: string; from_id: string; created_at: string }[]>(`cheers?select=id,to_id,from_id,created_at&to_id=${O}&created_at=gte.${since}`)
  const checkRaw = groupIds.length ? await db.get<{ id: string; group_id: string; owner_id: string; score: number | null; created_at: string }[]>(`checkins?select=id,group_id,owner_id,score,created_at&group_id=${inList(groupIds)}&created_at=gte.${since}`) : []
  const shares = groupIds.length ? await db.get<{ group_id: string; user_id: string; share: string }[]>(`group_members?select=group_id,user_id,share&group_id=${inList(groupIds)}`) : []
  const nameIds = [...new Set([...cheersRaw.map((c) => c.from_id), ...checkRaw.map((c) => c.owner_id)])]
  const names = nameIds.length ? await db.get<{ id: string; display_name: string | null }[]>(`profiles?select=id,display_name&id=${inList(nameIds)}`) : []
  const nameOf = (id: string) => names.find((n) => n.id === id)?.display_name?.split(' ')[0] || 'Alguém'
  return {
    people,
    data: {
      cycles: cyc.map((c) => ({ owner_id: c.owner_id, starts_on: c.starts_on })),
      steps: stepRows.map((s) => { const g = goals.find((x) => x.id === s.goal_id)!; const c = cyc.find((x) => x.id === g.cycle_id)!; return { owner_id: g.owner_id, week: s.week, starts_on: c.starts_on, done_at: s.done_at } }),
      habits, events, tasks,
      groups: gm.map((g) => ({ user_id: g.user_id, group_id: g.group_id, name: g.groups?.name ?? 'grupo', checkin_weekday: g.groups?.checkin_weekday ?? 1 })),
      cheers: cheersRaw.map((c) => ({ id: c.id, to_id: c.to_id, from_name: nameOf(c.from_id), created_at: c.created_at })),
      checkins: checkRaw.map((c) => ({ ...c, owner_name: nameOf(c.owner_id), visible: shares.some((s) => s.group_id === c.group_id && s.user_id === c.owner_id && s.share !== 'nothing') })),
    },
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) })
  if (req.method !== 'POST') return json(req, 405, { error: 'method' })
  const body = await req.json().catch(() => ({})) as { action?: string }

  const secret = req.headers.get('x-sync-secret')
  if (!secret) {
    const user = await userOf(req)
    if (!user) return json(req, 401, { error: 'login' })
    const v = await vapid()
    if (body.action === 'test') {
      const subs = await db.get<SubRow[]>(`push_subscriptions?select=id,owner_id,endpoint,p256dh,auth&owner_id=eq.${user.id}`)
      const sent = await deliver(subs, { title: 'Notificações ligadas ✓', body: 'É assim que os avisos do Twelvefold chegam.', url: '/config/notificacoes', tag: 'teste' }, v)
      return json(req, 200, { sent, devices: subs.length })
    }
    return json(req, 200, { publicKey: v.publicKey })
  }

  if (!(await db.rpc<boolean>('sync_secret_ok', { p_secret: secret }))) return json(req, 401, { error: 'secret' })
  const subs = await db.getAll<SubRow>('push_subscriptions?select=id,owner_id,endpoint,p256dh,auth')
  const owners = [...new Set(subs.map((s) => s.owner_id))]
  if (!owners.length) return json(req, 200, { sent: 0 })
  const v = await vapid()
  const { people, data } = await gather(owners)
  let sent = 0
  for (const o of due(people, data)) {
    if (!(await claim(o.owner, o.kind, o.key))) continue
    sent += await deliver(subs.filter((s) => s.owner_id === o.owner), { title: o.title, body: o.body, url: o.url, tag: `${o.kind}:${o.key}` }, v)
  }
  return json(req, 200, { sent })
})
