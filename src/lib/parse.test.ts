import { describe, expect, it } from 'vitest'
import { parseQuick } from './parse'

// sábado, 7 de novembro de 2026, 10:00
const NOW = new Date(2026, 10, 7, 10, 0)

describe('parseQuick', () => {
  it('compromisso com dia da semana e hora', () => {
    const p = parseQuick('dentista sexta 15h', NOW)
    expect(p).toMatchObject({ kind: 'event', title: 'Dentista', date: '2026-11-13', time: '15:00' })
  })
  it('gasto com vírgula', () => {
    const p = parseQuick('almoço 12,50', NOW)
    expect(p).toMatchObject({ kind: 'expense', title: 'Almoço', amountCents: 1250, category: 'wants' })
  })
  it('gasto com euro e necessidade', () => {
    expect(parseQuick('supermercado 42€', NOW)).toMatchObject({ kind: 'expense', amountCents: 4200, category: 'needs' })
  })
  it('tarefa para amanhã', () => {
    expect(parseQuick('ligar pra mãe amanhã', NOW)).toMatchObject({ kind: 'task', title: 'Ligar pra mãe', date: '2026-11-08', time: null })
  })
  it('hábito com vários dias', () => {
    expect(parseQuick('correr seg qua sex', NOW)).toMatchObject({ kind: 'habit', title: 'Correr', days: [1, 3, 5] })
  })
  it('hora com minutos e "às"', () => {
    expect(parseQuick('reunião às 9h30 hoje', NOW)).toMatchObject({ kind: 'event', time: '09:30', date: '2026-11-07', title: 'Reunião' })
  })
  it('data dd/mm no passado vai para o ano seguinte', () => {
    expect(parseQuick('renovar passaporte 02/01', NOW).date).toBe('2027-01-02')
  })
  it('tarefa simples', () => {
    expect(parseQuick('comprar detergente', NOW)).toMatchObject({ kind: 'task', title: 'Comprar detergente', date: null })
  })
})
