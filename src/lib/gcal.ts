import { addDays, addMonths } from 'date-fns'
import { ymd, toIso } from './dates'
import type { CalEvent } from './types'

/** Lê (só leitura) as agendas e eventos do Google com o token que o Google deu no login. */
const API = 'https://www.googleapis.com/calendar/v3'
const TOKEN_KEY = 'gcal-token'

export function saveToken(token: string) {
  try { sessionStorage.setItem(TOKEN_KEY, JSON.stringify({ token, exp: Date.now() + 50 * 60 * 1000 })) } catch { /* */ }
}
export function getToken(): string | null {
  try {
    const raw = sessionStorage.getItem(TOKEN_KEY)
    if (!raw) return null
    const { token, exp } = JSON.parse(raw) as { token: string; exp: number }
    return exp > Date.now() ? token : null
  } catch { return null }
}
export function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* */ } }

async function get<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } })
  if (r.status === 401) { clearToken(); throw new Error('A ligação com o Google expirou. Toque em importar de novo.') }
  if (r.status === 403) throw new Error('O Google recusou o acesso à agenda. Confira se a Google Calendar API está ativada e se você aceitou ver a agenda.')
  if (!r.ok) throw new Error(`Google respondeu ${r.status}`)
  return r.json() as Promise<T>
}

interface GCal { id: string; summary: string; selected?: boolean; primary?: boolean; accessRole: string }
interface GEvent {
  id: string; status: string; summary?: string; location?: string; description?: string; htmlLink?: string
  start: { date?: string; dateTime?: string }; end: { date?: string; dateTime?: string }
  eventType?: string; transparency?: string
}

export async function listCalendars(token: string) {
  const out: GCal[] = []
  let pageToken = ''
  do {
    const r = await get<{ items: GCal[]; nextPageToken?: string }>(token, '/users/me/calendarList', { maxResults: '250', ...(pageToken ? { pageToken } : {}) })
    out.push(...r.items); pageToken = r.nextPageToken ?? ''
  } while (pageToken)
  return out
}

/** Eventos de 1 mês atrás até 12 meses à frente, com repetições já abertas em ocorrências. */
export async function fetchEvents(token: string, cals: GCal[]) {
  const timeMin = addMonths(new Date(), -1).toISOString()
  const timeMax = addMonths(new Date(), 12).toISOString()
  const rows: Partial<CalEvent>[] = []
  for (const c of cals) {
    let pageToken = ''
    do {
      const r = await get<{ items: GEvent[]; nextPageToken?: string }>(token, `/calendars/${encodeURIComponent(c.id)}/events`, {
        singleEvents: 'true', orderBy: 'startTime', timeMin, timeMax, maxResults: '2500', ...(pageToken ? { pageToken } : {}),
      })
      for (const e of r.items) {
        if (e.status === 'cancelled' || e.eventType === 'workingLocation') continue
        const row = toRow(e, c)
        if (row) rows.push(row)
      }
      pageToken = r.nextPageToken ?? ''
    } while (pageToken)
  }
  return { rows, timeMin, timeMax }
}

const clip = (s: string | undefined, n: number) => (s ? s.slice(0, n) : null)

export function toRow(e: GEvent, c: GCal): Partial<CalEvent> | null {
  const allDay = !!e.start.date
  let starts: string, ends: string
  if (allDay) {
    // no Google o fim de um evento de dia inteiro é exclusivo (dia seguinte)
    const last = ymd(addDays(new Date(e.end.date! + 'T12:00:00'), -1))
    starts = toIso(e.start.date!, '00:00'); ends = toIso(last < e.start.date! ? e.start.date! : last, '23:59')
  } else {
    if (!e.start.dateTime || !e.end.dateTime) return null
    starts = new Date(e.start.dateTime).toISOString(); ends = new Date(e.end.dateTime).toISOString()
    if (ends <= starts) ends = new Date(new Date(starts).getTime() + 30 * 60000).toISOString()
  }
  const calNote = c.primary ? '' : `Agenda: ${c.summary}`
  const notes = [calNote, e.description ?? ''].filter(Boolean).join('\n\n')
  return {
    external_id: `gcal:${c.id}:${e.id}`.slice(0, 300),
    title: (e.summary || '(sem título)').slice(0, 200),
    starts_at: starts, ends_at: ends, all_day: allDay, kind: 'appointment',
    location: clip(e.location, 200), notes: clip(notes, 5000),
  }
}
