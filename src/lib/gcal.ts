import { addDays, addMonths } from 'date-fns'
import { ymd, toIso } from './dates'
import type { CalEvent, Calendar } from './types'
import { insert, remove, select, update } from './db'

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
  if (r.status === 403) {
    clearToken()
    const body = await r.text().catch(() => '')
    if (/SERVICE_DISABLED|accessNotConfigured|has not been used/i.test(body))
      throw new Error('Falta ativar a Google Calendar API no Google Cloud (projeto Dream Board). Depois de ativar, espere 2 minutos e tente de novo.')
    throw new Error('O Google não deu permissão para ver a agenda. Toque em importar de novo e, na tela do Google, marque a caixa de ver suas agendas.')
  }
  if (!r.ok) throw new Error(`Google respondeu ${r.status}`)
  return r.json() as Promise<T>
}

export interface GCal { id: string; summary: string; summaryOverride?: string; selected?: boolean; primary?: boolean; accessRole: string; backgroundColor?: string }
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

/** Guarda as agendas do Google: novas entram visíveis só se estão marcadas no Google; as que você já ajustou mantêm a escolha. */
export async function syncCalendars(cals: GCal[]) {
  const existing = (await select<Calendar>('calendars')).filter((c) => c.external_id.startsWith('gcal:'))
  const seen = new Set<string>()
  for (const [i, c] of cals.entries()) {
    const key = `gcal:${c.id}`.slice(0, 300)
    seen.add(key)
    const name = (c.summaryOverride || c.summary || 'Agenda').slice(0, 200)
    const color = /^#[0-9a-fA-F]{6}$/.test(c.backgroundColor ?? '') ? c.backgroundColor! : null
    const row = existing.find((x) => x.external_id === key)
    if (row) { if (row.name !== name || row.color !== color || row.position !== i) await update<Calendar>('calendars', row.id, { name, color, position: i }) }
    else await insert<Calendar>('calendars', { external_id: key, name, color, visible: !!(c.selected || c.primary), position: i })
  }
  for (const row of existing) if (!seen.has(row.external_id)) await remove('calendars', row.id)
}
