import { describe, expect, it } from 'vitest'
import { due, inQuiet, prefsOf, type Data } from './notify'

const empty: Data = { cycles: [], steps: [], habits: [], events: [], tasks: [], groups: [], cheers: [], checkins: [] }
const me = { id: 'u1', timezone: 'Europe/Lisbon', notify: {} }
const at = (iso: string) => Date.parse(iso)

describe('avisos', () => {
  it('domingo 18:02 em Lisboa: planejar a semana seguinte', () => {
    const d = { ...empty, cycles: [{ owner_id: 'u1', starts_on: '2026-10-15' }] }
    const out = due([me], d, at('2026-11-15T18:02:00Z'))
    expect(out.map((o) => o.kind)).toEqual(['plan'])
    expect(out[0].title).toBe('Vamos planejar a semana 6?')
  })
  it('fora da janela não avisa', () => {
    expect(due([me], empty, at('2026-11-15T18:20:00Z'))).toEqual([])
  })
  it('resumo da manhã com passos, hábitos e primeiro bloco (São Paulo)', () => {
    const sp = { id: 'u1', timezone: 'America/Sao_Paulo', notify: {} }
    const d: Data = { ...empty, cycles: [{ owner_id: 'u1', starts_on: '2026-10-15' }],
      steps: [{ owner_id: 'u1', week: 5, starts_on: '2026-10-15', done_at: null }, { owner_id: 'u1', week: 5, starts_on: '2026-10-15', done_at: '2026-11-13' }],
      habits: [{ id: 'h', owner_id: 'u1', title: 'Journal', days: [0, 1, 2, 3, 4, 5, 6], reminder_time: null }],
      events: [{ id: 'e', owner_id: 'u1', title: 'Portfólio', starts_at: '2026-11-14T12:30:00Z', all_day: false, reminder_minutes: null }] }
    const out = due([sp], d, at('2026-11-14T11:01:00Z')) // 08:01 em SP
    expect(out[0].body).toBe('1 passo e 1 hábito hoje. Primeiro bloco: Portfólio às 09:30.')
  })
  it('não perturbar segura avisos comuns mas não o lembrete que a pessoa marcou', () => {
    const d: Data = { ...empty, habits: [{ id: 'h', owner_id: 'u1', title: 'Ler', days: [6], reminder_time: '23:30:00' }],
      tasks: [{ id: 't', owner_id: 'u1', title: 'Tomar remédio', remind_at: '2026-11-14T23:30:00Z' }] }
    const out = due([me], d, at('2026-11-14T23:31:00Z'))
    expect(out.map((o) => o.kind)).toEqual(['task'])
  })
  it('placar das outras pessoas vem desligado e respeita a privacidade', () => {
    const d: Data = { ...empty, groups: [{ user_id: 'u1', group_id: 'g', name: 'Meninas', checkin_weekday: 1 }],
      checkins: [{ id: 'c', group_id: 'g', owner_id: 'u2', owner_name: 'Lu', score: 88, created_at: '2026-11-14T10:00:00Z', visible: true },
        { id: 'c2', group_id: 'g', owner_id: 'u3', owner_name: 'Nath', score: 50, created_at: '2026-11-14T10:00:00Z', visible: false }] }
    expect(due([me], d, at('2026-11-14T10:01:00Z'))).toEqual([])
    const on = { ...me, notify: { scores: { on: true } } }
    expect(due([on], d, at('2026-11-14T10:01:00Z')).map((o) => o.title)).toEqual(['Lu fez o check-in: 88%'])
  })
  it('preferências parciais completam com o padrão', () => {
    const p = prefsOf({ plan: { time: '19:00' } })
    expect(p.plan).toEqual({ on: true, time: '19:00' })
    expect(inQuiet(p, new Date('2026-11-14T06:00:00Z'), 'Europe/Lisbon')).toBe(true)
  })
})
