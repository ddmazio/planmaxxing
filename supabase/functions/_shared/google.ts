import { addDaysYmd, zonedIso } from './time.ts'

export const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/calendar.readonly'
const API = 'https://www.googleapis.com/calendar/v3'

export interface GCal { id: string; summary: string; summaryOverride?: string; selected?: boolean; primary?: boolean; backgroundColor?: string }
export interface GEvent {
  id: string; status: string; summary?: string; location?: string; description?: string; eventType?: string
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }
}
export interface EventRow {
  external_id: string; title: string; starts_at: string; ends_at: string; all_day: boolean
  kind: 'appointment'; location: string | null; notes: string | null
}

export const calKey = (calId: string) => `gcal:${calId}`.slice(0, 300)
export const eventKey = (calId: string, evId: string) => `gcal:${calId}:${evId}`.slice(0, 300)

/** Evento do Google → linha do app (igual à importação manual do app). */
export function toRow(e: GEvent, c: GCal, tz: string): EventRow | null {
  if (e.status === 'cancelled' || e.eventType === 'workingLocation' || !e.start || !e.end) return null
  const allDay = !!e.start.date
  let starts: string, ends: string
  if (allDay) {
    const last = addDaysYmd(e.end.date!, -1)
    starts = zonedIso(e.start.date!, '00:00', tz)
    ends = zonedIso(last < e.start.date! ? e.start.date! : last, '23:59', tz)
  } else {
    if (!e.start.dateTime || !e.end.dateTime) return null
    starts = new Date(e.start.dateTime).toISOString(); ends = new Date(e.end.dateTime).toISOString()
    if (ends <= starts) ends = new Date(new Date(starts).getTime() + 30 * 60000).toISOString()
  }
  const notes = [c.primary ? '' : `Agenda: ${c.summaryOverride || c.summary}`, e.description ?? ''].filter(Boolean).join('\n\n')
  return {
    external_id: eventKey(c.id, e.id), title: (e.summary || '(sem título)').slice(0, 200),
    starts_at: starts, ends_at: ends, all_day: allDay, kind: 'appointment',
    location: e.location ? e.location.slice(0, 200) : null, notes: notes ? notes.slice(0, 5000) : null,
  }
}

export function calendarRow(c: GCal, i: number) {
  return {
    external_id: calKey(c.id), name: (c.summaryOverride || c.summary || 'Agenda').slice(0, 200),
    color: /^#[0-9a-fA-F]{6}$/.test(c.backgroundColor ?? '') ? c.backgroundColor! : null, position: i,
    visible: !!(c.selected || c.primary),
  }
}

async function get<T>(token: string, path: string, params: Record<string, string>): Promise<T> {
  const r = await fetch(`${API}${path}?${new URLSearchParams(params)}`, { headers: { Authorization: `Bearer ${token}` } })
  if (!r.ok) throw new Error(`Google ${path.split('/')[1]} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  return r.json() as Promise<T>
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

/** Eventos da janela (1 mês atrás a 12 à frente). Com updatedMin, só o que mudou, incluindo os apagados. */
export async function listEvents(token: string, cal: GCal, timeMin: string, timeMax: string, updatedMin?: string) {
  const items: GEvent[] = []
  let pageToken = ''
  do {
    const r = await get<{ items: GEvent[]; nextPageToken?: string }>(token, `/calendars/${encodeURIComponent(cal.id)}/events`, {
      singleEvents: 'true', timeMin, timeMax, maxResults: '2500',
      ...(updatedMin ? { updatedMin, showDeleted: 'true' } : {}), ...(pageToken ? { pageToken } : {}),
    })
    items.push(...r.items); pageToken = r.nextPageToken ?? ''
  } while (pageToken)
  return items
}

export async function refreshGoogle(clientId: string, clientSecret: string, refreshToken: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error === 'invalid_grant' ? 'O Google desligou o acesso. Ligue de novo em Configurações.' : `Google token ${r.status}`)
  return j.access_token as string
}
