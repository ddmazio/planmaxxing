import { afterEach, describe, expect, it, vi } from 'vitest'
import { grants, parseEventKey, sameContent, toGoogle, type AppEvent } from './google.ts'
import { pushGoogle } from './core.ts'
import type { Db } from './rest.ts'

const TZ = 'Europe/Lisbon'
const ev = (p: Partial<AppEvent> = {}): AppEvent => ({
  id: 'e1', title: 'Dentista', starts_at: '2026-11-20T10:00:00.000Z', ends_at: '2026-11-20T11:00:00.000Z', all_day: false,
  location: null, notes: null, external_id: null, remote_updated: null, ...p,
})

describe('Google: escrita (peças)', () => {
  it('lê o que a pessoa marcou na tela do Google', () => {
    expect(grants('openid https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events')).toEqual({ read: true, write: true })
    expect(grants('https://www.googleapis.com/auth/calendar.readonly https://www.googleapis.com/auth/calendar.events.readonly')).toEqual({ read: true, write: false })
  })
  it('separa agenda e evento', () => {
    expect(parseEventKey('gcal:a#holiday@group.v.calendar.google.com:ws_20261110')).toEqual({ calId: 'a#holiday@group.v.calendar.google.com', evId: 'ws_20261110' })
    expect(parseEventKey('gcal:x')).toBeNull()
    expect(parseEventKey(null)).toBeNull()
  })
  it('dia inteiro vira datas (fim exclusivo) e tira a linha "Agenda:"', () => {
    const b = toGoogle(ev({ all_day: true, starts_at: '2026-11-10T00:00:00.000Z', ends_at: '2026-11-13T23:59:00.000Z', notes: 'Agenda: Trabalho\n\nLevar crachá' }), TZ)
    expect(b.start).toEqual({ date: '2026-11-10', dateTime: null })
    expect(b.end).toEqual({ date: '2026-11-14', dateTime: null })
    expect(b.description).toBe('Levar crachá')
  })
  it('com hora vai em ISO', () => {
    const b = toGoogle(ev(), TZ)
    expect(b.start).toEqual({ dateTime: '2026-11-20T10:00:00.000Z', date: null })
    expect(b.summary).toBe('Dentista')
  })
  it('compara só o que a pessoa vê', () => {
    expect(sameContent(ev(), ev({ starts_at: '2026-11-20T10:00:00Z', location: '' }))).toBe(true)
    expect(sameContent(ev(), ev({ title: 'Outro' }))).toBe(false)
  })
})

// banco de mentira: guarda o que a função grava
function fakeDb(rows: Record<string, AppEvent>, outbox: { id: number; op: 'upsert' | 'delete'; entity_id: string; external_id: string | null }[], conflicts: { event_id: string }[] = []) {
  const patches: { path: string; body: Record<string, unknown> }[] = []
  const inserted: { table: string; rows: unknown[] }[] = []
  let taken = false
  const db = {
    rpc: async (fn: string) => { if (fn !== 'sync_take_google') throw new Error(fn); if (taken) return []; taken = true; return outbox },
    get: async (path: string) => {
      const id = /id=eq\.([^&]+)/.exec(path)?.[1] ?? ''
      if (path.startsWith('events?')) return rows[id] ? [rows[id]] : []
      if (path.startsWith('event_conflicts?')) return conflicts.filter((c) => c.event_id === id)
      return []
    },
    getAll: async () => [],
    patch: async (path: string, body: Record<string, unknown>) => { patches.push({ path, body }) },
    insert: async (table: string, r: unknown[]) => { inserted.push({ table, rows: r }) },
    upsert: async () => null, del: async () => null,
  } as unknown as Db
  return { db, patches, inserted }
}

type Call = { method: string; url: string; body?: Record<string, unknown> }
function fakeGoogle(handler: (c: Call) => { status: number; json?: unknown }) {
  const calls: Call[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const c = { method: init.method ?? 'GET', url, body: init.body ? JSON.parse(init.body as string) : undefined }
    calls.push(c)
    const r = handler(c)
    return new Response(r.json === undefined ? null : JSON.stringify(r.json), { status: r.status })
  })
  return calls
}
afterEach(() => vi.unstubAllGlobals())

const cals = [{ id: 'eu@gmail.com', summary: 'eu@gmail.com', primary: true }, { id: 'trab@group.calendar.google.com', summary: 'Trabalho' }]

describe('Google: envio da fila', () => {
  it('evento novo do app vai para a agenda principal e fica ligado', async () => {
    const { db, patches } = fakeDb({ e1: ev() }, [{ id: 1, op: 'upsert', entity_id: 'e1', external_id: null }])
    const calls = fakeGoogle(() => ({ status: 200, json: { id: 'g1', status: 'confirmed', updated: '2026-11-14T10:00:00.000Z' } }))
    const r = await pushGoogle(db, 'u', TZ, 'tok', cals)
    expect(r).toEqual({ sent: 1, conflicts: 0 })
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url).toContain('/calendars/eu%40gmail.com/events')
    expect(patches[0].body).toEqual({ external_id: 'gcal:eu@gmail.com:g1', remote_updated: '2026-11-14T10:00:00.000Z' })
  })

  it('mudou só aqui: atualiza lá', async () => {
    const row = ev({ external_id: 'gcal:trab@group.calendar.google.com:g2', remote_updated: '2026-11-14T09:00:00.000Z', title: 'Reunião (nova hora)' })
    const { db, patches } = fakeDb({ e1: row }, [{ id: 1, op: 'upsert', entity_id: 'e1', external_id: row.external_id }])
    const calls = fakeGoogle((c) => c.method === 'GET'
      ? { status: 200, json: { id: 'g2', status: 'confirmed', updated: '2026-11-14T09:00:00.000Z', summary: 'Reunião', start: { dateTime: row.starts_at }, end: { dateTime: row.ends_at } } }
      : { status: 200, json: { id: 'g2', status: 'confirmed', updated: '2026-11-14T11:00:00.000Z' } })
    const r = await pushGoogle(db, 'u', TZ, 'tok', cals)
    expect(r.sent).toBe(1)
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PATCH'])
    expect(calls[1].body?.summary).toBe('Reunião (nova hora)')
    expect(patches[0].body).toEqual({ remote_updated: '2026-11-14T11:00:00.000Z' })
  })

  it('mudou nos dois lugares: abre conflito e não sobrescreve', async () => {
    const row = ev({ external_id: 'gcal:eu@gmail.com:g3', remote_updated: '2026-11-14T09:00:00.000Z', title: 'Jantar às 20h' })
    const { db, inserted } = fakeDb({ e1: row }, [{ id: 1, op: 'upsert', entity_id: 'e1', external_id: row.external_id }])
    const calls = fakeGoogle(() => ({ status: 200, json: { id: 'g3', status: 'confirmed', updated: '2026-11-14T10:30:00.000Z', summary: 'Jantar às 21h', start: { dateTime: row.starts_at }, end: { dateTime: row.ends_at } } }))
    const r = await pushGoogle(db, 'u', TZ, 'tok', cals)
    expect(r).toEqual({ sent: 0, conflicts: 1 })
    expect(calls.map((c) => c.method)).toEqual(['GET'])
    const c = inserted[0].rows[0] as { event_id: string; local: { title: string }; remote: { title: string; updated: string } }
    expect(inserted[0].table).toBe('event_conflicts')
    expect(c.local.title).toBe('Jantar às 20h')
    expect(c.remote.title).toBe('Jantar às 21h')
    expect(c.remote.updated).toBe('2026-11-14T10:30:00.000Z')
  })

  it('mudou nos dois lugares para a mesma coisa: só religa', async () => {
    const row = ev({ external_id: 'gcal:eu@gmail.com:g4', remote_updated: '2026-11-14T09:00:00.000Z' })
    const { db, inserted, patches } = fakeDb({ e1: row }, [{ id: 1, op: 'upsert', entity_id: 'e1', external_id: row.external_id }])
    fakeGoogle(() => ({ status: 200, json: { id: 'g4', status: 'confirmed', updated: '2026-11-14T10:30:00.000Z', summary: 'Dentista', start: { dateTime: row.starts_at }, end: { dateTime: row.ends_at } } }))
    const r = await pushGoogle(db, 'u', TZ, 'tok', cals)
    expect(r.conflicts).toBe(0)
    expect(inserted).toHaveLength(0)
    expect(patches[0].body).toEqual({ remote_updated: '2026-11-14T10:30:00.000Z' })
  })

  it('com conflito aberto, espera a pessoa escolher', async () => {
    const row = ev({ external_id: 'gcal:eu@gmail.com:g5', remote_updated: '2026-11-14T09:00:00.000Z' })
    const { db } = fakeDb({ e1: row }, [{ id: 1, op: 'upsert', entity_id: 'e1', external_id: row.external_id }], [{ event_id: 'e1' }])
    const calls = fakeGoogle(() => ({ status: 200, json: {} }))
    expect(await pushGoogle(db, 'u', TZ, 'tok', cals)).toEqual({ sent: 0, conflicts: 0 })
    expect(calls).toHaveLength(0)
  })

  it('apagado aqui: apaga lá (e já apagado lá não é erro)', async () => {
    const { db } = fakeDb({}, [{ id: 1, op: 'upsert', entity_id: 'e9', external_id: 'gcal:eu@gmail.com:g9' }, { id: 2, op: 'delete', entity_id: 'e9', external_id: 'gcal:eu@gmail.com:g9' }])
    const calls = fakeGoogle(() => ({ status: 410 }))
    expect((await pushGoogle(db, 'u', TZ, 'tok', cals)).sent).toBe(1)
    expect(calls.map((c) => `${c.method} ${c.url.split('/v3')[1]}`)).toEqual(['DELETE /calendars/eu%40gmail.com/events/g9'])
  })

  it('sem permissão (401) para tudo; outros erros pulam só o item', async () => {
    const { db } = fakeDb({ e1: ev() }, [{ id: 1, op: 'upsert', entity_id: 'e1', external_id: null }])
    fakeGoogle(() => ({ status: 401, json: { error: 'x' } }))
    await expect(pushGoogle(db, 'u', TZ, 'tok', cals)).rejects.toThrow(/401/)
    const second = fakeDb({ e1: ev() }, [{ id: 1, op: 'upsert', entity_id: 'e1', external_id: null }])
    fakeGoogle(() => ({ status: 403, json: { error: 'readonly calendar' } }))
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await pushGoogle(second.db, 'u', TZ, 'tok', cals)).toEqual({ sent: 0, conflicts: 0 })
  })
})
