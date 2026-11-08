import { addDays, format, startOfWeek, isSameDay, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export const ymd = (d: Date) => format(d, 'yyyy-MM-dd')
export const todayYmd = () => ymd(new Date())
export const fromYmd = (s: string) => parseISO(s)
export const fmt = (d: Date, f: string) => format(d, f, { locale: ptBR })
export const weekStart = (d: Date, startsOn = 1) => startOfWeek(d, { weekStartsOn: startsOn as 0 | 1 })
export const weekDays = (d: Date, startsOn = 1) => Array.from({ length: 7 }, (_, i) => addDays(weekStart(d, startsOn), i))
export { addDays, isSameDay }

/** "sábado, 7 de novembro" */
export const longDay = (d: Date) => fmt(d, "EEEE, d 'de' MMMM")
export const hhmm = (iso: string) => format(new Date(iso), 'HH:mm')

export function greeting(d = new Date()) {
  const h = d.getHours()
  return h < 12 ? 'Bom dia' : h < 19 ? 'Boa tarde' : 'Boa noite'
}

/** Junta uma data (yyyy-MM-dd) e hora (HH:mm) locais num ISO com fuso. */
export function toIso(date: string, time = '00:00') {
  const [y, m, d] = date.split('-').map(Number)
  const [hh, mm] = time.split(':').map(Number)
  return new Date(y, m - 1, d, hh, mm).toISOString()
}
