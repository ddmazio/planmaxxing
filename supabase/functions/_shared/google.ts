import { addDaysYmd, ymdIn, zonedIso } from './time.ts'

export const READ_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly'
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'
export const GOOGLE_SCOPE = `openid email ${READ_SCOPE} ${WRITE_SCOPE}`
/** O que a pessoa marcou na tela do Google (ela pode desmarcar a escrita). */
export const grants = (scope: string) => { const s = scope.split(/\s+/); return { read: s.includes(READ_SCOPE), write: s.includes(WRITE_SCOPE) } }
const API = 'https://www.googleapis.com/calendar/v3'

export interface GCal { id: string; summary: string; summaryOverride?: string; selected?: boolean; primary?: boolean; backgroundColor?: string }
export interface GEvent {
  id: string; status: string; updated?: string; summary?: string; location?: string; description?: string; eventType?: string
  start?: { date?: string; dateTime?: string }; end?: { date?: string; dateTime?: string }
}
export interface EventRow {
  external_id: string; title: string; starts_at: string; ends_at: string; all_day: boolean
  location: string | null; notes: string | null; remote_updated: string | null
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
    starts_at: starts, ends_at: ends, all_day: allDay,
    location: e.location ? e.location.slice(0, 200) : null, notes: notes ? notes.slice(0, 5000) : null, remote_updated: e.updated ?? null,
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

// ---------------------------------------------------------------- escrita (app → Google)
export interface AppEvent {
  id: string; title: string; starts_at: string; ends_at: string; all_day: boolean
  location: string | null; notes: string | null; external_id: string | null; remote_updated: string | null
}

/** "gcal:<agenda>:<evento>" → as duas partes (mesma leitura que o app faz em calendars.ts). */
export function parseEventKey(k: string | null | undefined) {
  if (!k?.startsWith('gcal:')) return null
  const rest = k.slice(5), i = rest.indexOf(':')
  if (i <= 0 || i === rest.length - 1) return null
  return { calId: rest.slice(0, i), evId: rest.slice(i + 1) }
}

/** Evento do app → corpo para a API do Google. A linha "Agenda: X" que a importação põe nas notas não volta. */
export function toGoogle(r: AppEvent, tz: string) {
  const description = (r.notes ?? '').replace(/^Agenda: [^\n]*(\n\n|\n|$)/, '')
  const base = { summary: r.title, location: r.location ?? '', description }
  if (r.all_day) {
    const a = ymdIn(new Date(r.starts_at), tz), b = ymdIn(new Date(r.ends_at), tz)
    return { ...base, start: { date: a, dateTime: null }, end: { date: addDaysYmd(b < a ? a : b, 1), dateTime: null } }
  }
  return { ...base, start: { dateTime: new Date(r.starts_at).toISOString(), date: null }, end: { dateTime: new Date(r.ends_at).toISOString(), date: null } }
}

/** Os campos que a pessoa vê, para comparar as duas versões. */
export const sameContent = (a: Pick<AppEvent, 'title' | 'starts_at' | 'ends_at' | 'all_day' | 'location' | 'notes'>, b: typeof a) =>
  a.title === b.title && Date.parse(a.starts_at) === Date.parse(b.starts_at) && Date.parse(a.ends_at) === Date.parse(b.ends_at) &&
  a.all_day === b.all_day && (a.location ?? '') === (b.location ?? '') && (a.notes ?? '') === (b.notes ?? '')

export class GoogleError extends Error { constructor(public status: number, msg: string) { super(msg) } }

/** Chamada de escrita. 404/410 (já não existe) devolve null. */
export async function gwrite<T>(token: string, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<T | null> {
  const r = await fetch(`${API}${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (r.status === 404 || r.status === 410) { await r.body?.cancel().catch(() => {}); return null }
  if (!r.ok) throw new GoogleError(r.status, `Google ${method} ${r.status}: ${(await r.text()).slice(0, 200)}`)
  if (r.status === 204) return null
  const text = await r.text()
  return (text ? JSON.parse(text) : null) as T | null
}
export const evPath = (calId: string, evId?: string) => `/calendars/${encodeURIComponent(calId)}/events${evId ? `/${encodeURIComponent(evId)}` : ''}`
