import { describe, expect, it } from 'vitest'
import { calKey, layoutDay } from './calendars'
import type { CalEvent } from './types'

const ev = (id: string, s: string, e: string) => ({ id, starts_at: `2026-11-02T${s}:00Z`, ends_at: `2026-11-02T${e}:00Z` }) as CalEvent
describe('agendas', () => {
  it('chave da agenda', () => {
    expect(calKey({ external_id: 'gcal:me@gmail.com:abc' })).toBe('gcal:me@gmail.com')
    expect(calKey({ external_id: null })).toBe('local')
  })
  it('eventos sobrepostos ficam lado a lado', () => {
    const l = layoutDay([ev('a', '10:00', '11:00'), ev('b', '10:30', '11:30'), ev('c', '10:45', '11:00'), ev('d', '12:00', '13:00')])
    expect(l.get('a')).toEqual({ col: 0, cols: 3 })
    expect(l.get('b')).toEqual({ col: 1, cols: 3 })
    expect(l.get('c')!.col).toBe(2)
    expect(l.get('d')).toEqual({ col: 0, cols: 1 })
  })
})
