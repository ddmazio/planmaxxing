/**
 * Teste de ponta a ponta da sincronização, contra um Postgres + PostgREST locais e
 * um Google Agenda e um Microsoft To Do simulados. Só roda com PGREST_URL e PGREST_SECRET definidos.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { makeDb } from './rest.ts'
import { type MsState, syncGoogle, syncMicrosoft } from './core.ts'

const URL_ = process.env.PGREST_URL
const SECRET = process.env.PGREST_SECRET
const b64u = (s: string | Buffer) => Buffer.from(s).toString('base64url')
const jwt = (claims: Record<string, unknown>) => {
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' })), p = b64u(JSON.stringify(claims))
  return `${h}.${p}.${createHmac('sha256', SECRET ?? '').update(`${h}.${p}`).digest('base64url')}`
}

// ---------------------------------------------------------------- To Do simulado
interface T { id: string; title: string; status: string; importance: string; body?: { content: string }; dueDateTime?: unknown; recurrence?: unknown; lastModifiedDateTime: string }
const ms = {
  lists: [{ id: 'DEF', displayName: 'Tarefas', wellknownListName: 'defaultList' }, { id: 'CASA', displayName: 'Casa', wellknownListName: 'none' }] as { id: string; displayName: string; wellknownListName: string }[],
  tasks: new Map<string, T[]>([['DEF', []], ['CASA', []]]),
  log: [] as { seq: number; list: string; id: string; removed: boolean }[],
  seq: 0,
}
let tick = Date.now()
const stamp = () => new Date((tick += 1000)).toISOString()
const touch = (list: string, id: string, removed = false) => ms.log.push({ seq: ++ms.seq, list, id, removed })
const msAdd = (list: string, title: string, extra: Partial<T> = {}) => {
  const t: T = { id: randomUUID().slice(0, 8), title, status: 'notStarted', importance: 'normal', lastModifiedDateTime: stamp(), ...extra }
  ms.tasks.get(list)!.push(t); touch(list, t.id); return t
}

function fakeGraph(url: string, init?: RequestInit): Response {
  const u = new URL(url)
  const path = u.pathname.replace('/v1.0', '')
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  const ok = (j: unknown, status = 200) => new Response(JSON.stringify(j), { status, headers: { 'Content-Type': 'application/json' } })
  let m: RegExpMatchArray | null
  if (path === '/me/todo/lists' && method === 'GET') return ok({ value: ms.lists })
  if (path === '/me/todo/lists' && method === 'POST') {
    const l = { id: 'L' + randomUUID().slice(0, 6), displayName: body.displayName, wellknownListName: 'none' }
    ms.lists.push(l); ms.tasks.set(l.id, []); return ok(l, 201)
  }
  if ((m = path.match(/^\/me\/todo\/lists\/([^/]+)$/))) {
    const l = ms.lists.find((x) => x.id === m![1]); if (!l) return new Response('', { status: 404 })
    if (method === 'PATCH') { l.displayName = body.displayName; return ok(l) }
    if (method === 'DELETE') { ms.lists = ms.lists.filter((x) => x !== l); ms.tasks.delete(l.id); return new Response(null, { status: 204 }) }
  }
  if ((m = path.match(/^\/me\/todo\/lists\/([^/]+)\/tasks\/delta$/)) || (m = path.match(/^\/delta\/([^/]+)$/))) {
    const list = m[1]; const since = Number(u.searchParams.get('since') ?? 0)
    if (!ms.tasks.has(list)) return new Response('', { status: 404 })
    const ids = [...new Set(ms.log.filter((e) => e.list === list && e.seq > since).map((e) => e.id))]
    const value = ids.map((id) => ms.tasks.get(list)!.find((t) => t.id === id) ?? { id, '@removed': { reason: 'deleted' } })
    return ok({ value, '@odata.deltaLink': `https://graph.microsoft.com/v1.0/delta/${list}?since=${ms.seq}` })
  }
  if ((m = path.match(/^\/me\/todo\/lists\/([^/]+)\/tasks$/)) && method === 'POST') {
    const t = msAdd(m[1], body.title, { status: body.status, importance: body.importance, body: body.body, dueDateTime: body.dueDateTime, recurrence: body.recurrence })
    return ok(t, 201)
  }
  if ((m = path.match(/^\/me\/todo\/lists\/([^/]+)\/tasks\/([^/]+)$/))) {
    const arr = ms.tasks.get(m[1]); const t = arr?.find((x) => x.id === m![2])
    if (!t) return new Response('', { status: 404 })
    if (method === 'PATCH') { Object.assign(t, { title: body.title, status: body.status, importance: body.importance, body: body.body, dueDateTime: body.dueDateTime, recurrence: body.recurrence ?? t.recurrence, lastModifiedDateTime: stamp() }); touch(m[1], t.id); return ok(t) }
    if (method === 'DELETE') { arr!.splice(arr!.indexOf(t), 1); touch(m[1], t.id, true); return new Response(null, { status: 204 }) }
  }
  return new Response(JSON.stringify({ error: 'nao simulado ' + method + ' ' + path }), { status: 500 })
}

// ---------------------------------------------------------------- Google simulado
const g = {
  cals: [{ id: 'eu@gmail.com', summary: 'Eu', primary: true, selected: true, backgroundColor: '#aabbcc' }, { id: 'pt#holiday@group.v.calendar.google.com', summary: 'Feriados', selected: false, backgroundColor: '#112233' }],
  events: new Map<string, { id: string; status: string; summary: string; start: object; end: object; updated: string }[]>(),
}
function fakeGoogle(url: string): Response {
  const u = new URL(url)
  const ok = (j: unknown) => new Response(JSON.stringify(j), { status: 200 })
  if (u.pathname.endsWith('/users/me/calendarList')) return ok({ items: g.cals })
  const m = u.pathname.match(/\/calendars\/([^/]+)\/events$/)
  if (m) {
    const id = decodeURIComponent(m[1]); const upd = u.searchParams.get('updatedMin')
    const items = (g.events.get(id) ?? []).filter((e) => !upd || e.updated >= upd).filter((e) => upd || e.status !== 'cancelled')
    return ok({ items })
  }
  return new Response('{}', { status: 500 })
}

const realFetch = globalThis.fetch
const A = '11111111-1111-1111-1111-111111111111'

describe.skipIf(!URL_ || !SECRET)('sincronização de ponta a ponta', () => {
  const db = makeDb(URL_!, jwt({ role: 'service_role' }))
  const user = makeDb(URL_!, jwt({ role: 'authenticated', sub: A }))
  // o PostgREST local não tem o prefixo /rest/v1 do Supabase
  beforeAll(() => {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.startsWith('https://graph.microsoft.com')) return fakeGraph(url, init)
      if (url.startsWith('https://www.googleapis.com')) return fakeGoogle(url)
      return realFetch(url.replace('/rest/v1/', '/'), init)
    }) as typeof fetch
  })
  afterAll(() => { globalThis.fetch = realFetch })

  const appTasks = () => db.get<{ title: string; external_id: string | null; completed_at: string | null; list_id: string | null }[]>(`tasks?select=title,external_id,completed_at,list_id&owner_id=eq.${A}&order=title`)
  const msTitles = (list: string) => (ms.tasks.get(list) ?? []).map((t) => t.title + (t.status === 'completed' ? ' ✓' : '')).sort()
  const state: MsState = {}

  it('primeira ligação: junta os dois lados sem duplicar', async () => {
    await db.rpc('integration_save', { p_owner: A, p_provider: 'microsoft', p_email: 'a@outlook.com', p_token: 'R' })
    await user.insert('lists', [{ name: 'Casa' }, { name: 'Mercado' }])
    const lists = await user.get<{ id: string; name: string }[]>('lists?select=id,name')
    const casaId = lists.find((l) => l.name === 'Casa')!.id, mercadoId = lists.find((l) => l.name === 'Mercado')!.id
    for (const row of [{ title: 'Pagar luz', list_id: casaId }, { title: 'Leite', list_id: mercadoId }, { title: 'Ligar mãe' }, { title: 'Feita antiga', completed_at: '2026-01-01T00:00:00Z' }]) await user.insert('tasks', [row])
    msAdd('CASA', 'Pagar luz'); msAdd('CASA', 'Varrer', { importance: 'high' }); msAdd('DEF', 'Email Ana')

    const r = await syncMicrosoft(db, A, 'Europe/Lisbon', 'token', state)
    expect(state.linked).toBe(true)
    const t = await appTasks()
    expect(t.map((x) => x.title)).toEqual(['Email Ana', 'Feita antiga', 'Leite', 'Ligar mãe', 'Pagar luz', 'Varrer'])
    expect(t.filter((x) => x.title !== 'Feita antiga').every((x) => x.external_id?.startsWith('ms:'))).toBe(true)
    const mercadoMs = ms.lists.find((l) => l.displayName === 'Mercado')!
    expect(msTitles('CASA')).toEqual(['Pagar luz', 'Varrer'])
    expect(msTitles(mercadoMs.id)).toEqual(['Leite'])
    expect(msTitles('DEF')).toEqual(['Email Ana', 'Ligar mãe'])
    expect(r.created).toBeGreaterThan(0)
  })

  it('mudanças no app chegam ao To Do (concluir, renomear, apagar, nova lista)', async () => {
    const t = await user.get<{ id: string; title: string }[]>('tasks?select=id,title')
    await user.patch(`tasks?id=eq.${t.find((x) => x.title === 'Varrer')!.id}`, { completed_at: new Date().toISOString() })
    await user.patch(`tasks?id=eq.${t.find((x) => x.title === 'Leite')!.id}`, { title: 'Leite sem lactose', important: true })
    await user.del(`tasks?id=eq.${t.find((x) => x.title === 'Email Ana')!.id}`)
    await user.insert('lists', [{ name: 'Viagem' }])
    const [viagem] = await user.get<{ id: string }[]>('lists?select=id&name=eq.Viagem')
    await user.insert('tasks', [{ title: 'Passaporte', list_id: viagem.id, due_on: '2026-12-01' }])
    await syncMicrosoft(db, A, 'Europe/Lisbon', 'token', state)
    expect(msTitles('CASA')).toEqual(['Pagar luz', 'Varrer ✓'])
    const mercadoMs = ms.lists.find((l) => l.displayName === 'Mercado')!
    expect(msTitles(mercadoMs.id)).toEqual(['Leite sem lactose'])
    expect(msTitles('DEF')).toEqual(['Ligar mãe'])
    const v = ms.lists.find((l) => l.displayName === 'Viagem')!
    expect(msTitles(v.id)).toEqual(['Passaporte'])
    expect((ms.tasks.get(v.id)![0].dueDateTime as { dateTime: string }).dateTime).toBe('2026-12-01T12:00:00')
  })

  it('mudanças no To Do chegam ao app (nova, concluída, apagada, lista renomeada)', async () => {
    msAdd('CASA', 'Do celular')
    const luz = ms.tasks.get('CASA')!.find((x) => x.title === 'Pagar luz')!
    Object.assign(luz, { status: 'completed', completedDateTime: { dateTime: '2026-11-12T11:00:00.0000000', timeZone: 'UTC' }, lastModifiedDateTime: stamp() }); touch('CASA', luz.id)
    const mae = ms.tasks.get('DEF')!.find((x) => x.title === 'Ligar mãe')!
    ms.tasks.get('DEF')!.splice(ms.tasks.get('DEF')!.indexOf(mae), 1); touch('DEF', mae.id, true)
    ms.lists.find((l) => l.id === 'CASA')!.displayName = 'Casa & família'
    await syncMicrosoft(db, A, 'Europe/Lisbon', 'token', state)
    const t = await appTasks()
    expect(t.map((x) => x.title)).toEqual(['Do celular', 'Feita antiga', 'Leite sem lactose', 'Pagar luz', 'Passaporte', 'Varrer'])
    expect(t.find((x) => x.title === 'Pagar luz')!.completed_at).toBe('2026-11-12T11:00:00+00:00')
    const [casa] = await db.get<{ name: string }[]>('lists?select=name&external_id=eq.ms:CASA')
    expect(casa.name).toBe('Casa & família')
    expect(await db.get<unknown[]>(`sync_outbox?owner_id=eq.${A}`)).toEqual([])
  })

  it('rodar de novo não duplica nada nem faz eco', async () => {
    const before = (await appTasks()).length
    const msBefore = [...ms.tasks.values()].flat().length
    const r = await syncMicrosoft(db, A, 'Europe/Lisbon', 'token', state)
    expect(r.sent).toBe(0)
    expect((await appTasks()).length).toBe(before)
    expect([...ms.tasks.values()].flat().length).toBe(msBefore)
  })

  it('Google: primeira vez completa, depois só o que mudou, e cancelados saem', async () => {
    g.events.set('eu@gmail.com', [
      { id: 'e1', status: 'confirmed', summary: 'Dentista', start: { dateTime: '2026-11-13T15:00:00Z' }, end: { dateTime: '2026-11-13T16:00:00Z' }, updated: '2026-11-12T09:00:00Z' },
      { id: 'e2', status: 'confirmed', summary: 'Web Summit', start: { date: '2026-11-10' }, end: { date: '2026-11-14' }, updated: '2026-11-12T09:00:00Z' },
    ])
    g.events.set('pt#holiday@group.v.calendar.google.com', [{ id: 'h1', status: 'confirmed', summary: 'Feriado', start: { date: '2026-12-01' }, end: { date: '2026-12-02' }, updated: '2026-11-01T00:00:00Z' }])
    const r1 = await syncGoogle(db, A, 'Europe/Lisbon', 'tok', { last_sync_at: null, last_full_sync_at: null })
    expect(r1).toMatchObject({ full: true, saved: 3, calendars: 2 })
    const cals = await db.get<{ external_id: string; visible: boolean }[]>(`calendars?select=external_id,visible&owner_id=eq.${A}&order=position`)
    expect(cals).toEqual([{ external_id: 'gcal:eu@gmail.com', visible: true }, { external_id: 'gcal:pt#holiday@group.v.calendar.google.com', visible: false }])

    const last = new Date().toISOString()
    g.events.get('eu@gmail.com')![0] = { ...g.events.get('eu@gmail.com')![0], status: 'cancelled', updated: new Date(Date.now() + 1000).toISOString() }
    g.events.get('eu@gmail.com')!.push({ id: 'e3', status: 'confirmed', summary: 'Novo', start: { dateTime: '2026-11-20T10:00:00Z' }, end: { dateTime: '2026-11-20T11:00:00Z' }, updated: new Date(Date.now() + 1000).toISOString() })
    const r2 = await syncGoogle(db, A, 'Europe/Lisbon', 'tok', { last_sync_at: last, last_full_sync_at: last })
    expect(r2).toMatchObject({ full: false, saved: 1, removed: 1 })
    const ev = await db.get<{ title: string }[]>(`events?select=title&owner_id=eq.${A}&order=title`)
    expect(ev.map((e) => e.title)).toEqual(['Feriado', 'Novo', 'Web Summit'])
  })
})
