import { describe, expect, it } from 'vitest'
import { toRow } from './gcal'

const cal = { id: 'me@gmail.com', summary: 'Pessoal', primary: true, accessRole: 'owner' }
describe('Google Agenda', () => {
  it('evento com hora', () => {
    const r = toRow({ id: 'a1', status: 'confirmed', summary: 'Dentista', start: { dateTime: '2026-11-10T15:00:00+00:00' }, end: { dateTime: '2026-11-10T16:00:00+00:00' } }, cal)!
    expect(r.external_id).toBe('gcal:me@gmail.com:a1')
    expect(r.all_day).toBe(false)
    expect(r.starts_at).toBe('2026-11-10T15:00:00.000Z')
    expect(r.notes).toBe(null)
  })
  it('dia inteiro: o fim exclusivo do Google vira o próprio dia', () => {
    const r = toRow({ id: 'b', status: 'confirmed', start: { date: '2026-11-12' }, end: { date: '2026-11-13' } }, { ...cal, primary: false, summary: 'Aniversários' })!
    expect(r.all_day).toBe(true)
    expect(new Date(r.ends_at!).getDate()).toBe(12)
    expect(r.title).toBe('(sem título)')
    expect(r.notes).toBe('Agenda: Aniversários')
  })
})
