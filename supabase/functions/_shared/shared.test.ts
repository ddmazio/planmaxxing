import { describe, expect, it } from 'vitest'
import { addDaysYmd, graphDate, ymdIn, zonedIso } from './time.ts'
import { toRow } from './google.ts'
import { appToMs, msToApp, parseTaskKey, ruleFromMs, ruleToMs } from './microsoft.ts'
import { signState, verifyState } from './state.ts'
import { inList } from './rest.ts'

describe('fusos', () => {
  it('meia-noite em Lisboa no inverno e no verão', () => {
    expect(zonedIso('2026-11-12', '00:00', 'Europe/Lisbon')).toBe('2026-11-12T00:00:00.000Z')
    expect(zonedIso('2026-07-12', '00:00', 'Europe/Lisbon')).toBe('2026-07-11T23:00:00.000Z')
    expect(zonedIso('2026-11-12', '09:30', 'America/Sao_Paulo')).toBe('2026-11-12T12:30:00.000Z')
  })
  it('data no fuso', () => {
    expect(ymdIn(new Date('2026-07-11T23:00:00Z'), 'Europe/Lisbon')).toBe('2026-07-12')
    expect(ymdIn(new Date('2026-11-12T12:00:00Z'), 'America/Sao_Paulo')).toBe('2026-11-12')
    expect(addDaysYmd('2026-12-31', 1)).toBe('2027-01-01')
    expect(graphDate({ dateTime: '2026-11-12T10:00:00.0000000', timeZone: 'UTC' })!.toISOString()).toBe('2026-11-12T10:00:00.000Z')
  })
})

describe('Google no servidor', () => {
  const cal = { id: 'a#holiday@group.v.calendar.google.com', summary: 'Feriados' }
  it('evento de vários dias de dia inteiro', () => {
    const r = toRow({ id: 'ws', status: 'confirmed', summary: 'Web Summit', start: { date: '2026-11-10' }, end: { date: '2026-11-14' } }, cal, 'Europe/Lisbon')!
    expect(r.starts_at).toBe('2026-11-10T00:00:00.000Z')
    expect(r.ends_at).toBe('2026-11-13T23:59:00.000Z')
    expect(r.external_id).toBe('gcal:a#holiday@group.v.calendar.google.com:ws')
  })
  it('ignora cancelado', () => {
    expect(toRow({ id: 'x', status: 'cancelled' }, cal, 'Europe/Lisbon')).toBeNull()
  })
  it('lista para filtro com aspas', () => {
    expect(inList(['gcal:a#b@c:1', 'x"y'])).toBe('("gcal:a#b@c:1","x\\"y")')
  })
})

describe('Microsoft To Do', () => {
  it('repetições nos dois sentidos', () => {
    expect(ruleFromMs({ pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] } })).toBe('weekdays')
    expect(ruleFromMs({ pattern: { type: 'weekly', interval: 2, daysOfWeek: ['monday'] } })).toBeUndefined()
    expect(ruleFromMs(null)).toBeNull()
    expect(ruleToMs('weekly', '2026-11-12')!.pattern.daysOfWeek).toEqual(['thursday'])
    expect(ruleToMs('yearly', '2026-11-12')!.pattern).toMatchObject({ dayOfMonth: 12, month: 11 })
  })
  it('tarefa do To Do vira tarefa do app', () => {
    const r = msToApp({ id: 'T1', title: 'Pagar luz', status: 'completed', importance: 'high', body: { content: ' nota ' },
      dueDateTime: { dateTime: '2026-07-11T23:00:00.0000000', timeZone: 'UTC' }, completedDateTime: { dateTime: '2026-07-12T10:00:00.0000000', timeZone: 'UTC' },
      recurrence: { pattern: { type: 'daily', interval: 1 } }, lastModifiedDateTime: '2026-07-12T10:00:01Z' }, 'L1', false, 'Europe/Lisbon')
    expect(r).toMatchObject({ external_id: 'ms:L1:T1', list_external_id: 'ms:L1', important: true, notes: 'nota', due_on: '2026-07-12', repeat_rule: 'daily', completed_at: '2026-07-12T10:00:00.000Z' })
    const inbox = msToApp({ id: 'T2', title: 'x', recurrence: { pattern: { type: 'relativeMonthly', interval: 1 } } }, 'D', true, 'Europe/Lisbon')
    expect(inbox.list_external_id).toBeNull()
    expect('repeat_rule' in inbox).toBe(false)
  })
  it('tarefa do app vira tarefa do To Do', () => {
    const b = appToMs({ id: 'x', list_id: null, title: 'Ler', notes: null, important: false, due_on: '2026-11-12', remind_at: '2026-11-12T09:00:00+00:00', repeat_rule: 'monthly', completed_at: null, external_id: null }, '2026-11-01')
    expect(b).toMatchObject({ status: 'notStarted', importance: 'normal', dueDateTime: { dateTime: '2026-11-12T12:00:00', timeZone: 'UTC' }, isReminderOn: true, reminderDateTime: { dateTime: '2026-11-12T09:00:00.000', timeZone: 'UTC' } })
    expect((b.recurrence as { pattern: { type: string } }).pattern.type).toBe('absoluteMonthly')
    expect(parseTaskKey('ms:L:T')).toEqual({ listId: 'L', taskId: 'T' })
    expect(parseTaskKey('gcal:x')).toBeNull()
  })
})

describe('state do OAuth', () => {
  it('assina, confere e expira', async () => {
    const owner = '11111111-1111-1111-1111-111111111111'
    const s = await signState('segredo', owner, 'google', 1000)
    expect(await verifyState('segredo', s, 2000)).toEqual({ u: owner, p: 'google' })
    expect(await verifyState('outro', s, 2000)).toBeNull()
    expect(await verifyState('segredo', s, 1000 + 11 * 60000)).toBeNull()
    const [p, sig] = s.split('.')
    expect(await verifyState('segredo', p.slice(0, -2) + 'AA.' + sig, 2000)).toBeNull()
  })
})
