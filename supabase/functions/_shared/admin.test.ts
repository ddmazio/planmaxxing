import { describe, expect, it } from 'vitest'
import { inviteError, toPerson } from './admin.ts'

const NOW = Date.parse('2026-11-16T12:00:00Z')
describe('admin: pessoas', () => {
  it('bloqueada só enquanto o bloqueio vale', () => {
    const base = { id: 'a', email: 'x@y.com', created_at: '2026-11-01T00:00:00Z', last_sign_in_at: '2026-11-10T00:00:00Z' }
    expect(toPerson({ ...base, banned_until: '2126-01-01T00:00:00Z' }, null, false, NOW).blocked).toBe(true)
    expect(toPerson({ ...base, banned_until: '2026-11-01T00:00:00Z' }, null, false, NOW).blocked).toBe(false)
    expect(toPerson({ ...base, banned_until: null }, null, false, NOW).blocked).toBe(false)
  })
  it('convite pendente = nunca entrou; nome do perfil vem primeiro', () => {
    const p = toPerson({ id: 'b', email: 'b@y.com', created_at: '2026-11-01T00:00:00Z', user_metadata: { full_name: 'Bia G' } }, 'Bia', false, NOW)
    expect(p.pending).toBe(true)
    expect(p.name).toBe('Bia')
    expect(Object.keys(p).sort()).toEqual(['admin', 'blocked', 'created_at', 'email', 'id', 'last_sign_in_at', 'name', 'pending'])
  })
  it('mensagens de convite', () => {
    expect(inviteError('A user with this email address has already been registered')).toBe('Esta pessoa já tem conta.')
    expect(inviteError('email rate limit exceeded')).toMatch(/Espere/)
  })
})
