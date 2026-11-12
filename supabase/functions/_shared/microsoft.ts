import { graphDate, ymdIn } from './time.ts'

export const MS_SCOPE = 'offline_access User.Read Tasks.ReadWrite'
export const GRAPH = 'https://graph.microsoft.com/v1.0'
type Rule = 'daily' | 'weekly' | 'monthly' | 'yearly' | 'weekdays'

export interface MsList { id: string; displayName: string; wellknownListName?: string }
export interface MsTask {
  id: string; title?: string; status?: string; importance?: string
  body?: { content?: string; contentType?: string }
  dueDateTime?: { dateTime: string; timeZone: string } | null
  reminderDateTime?: { dateTime: string; timeZone: string } | null
  isReminderOn?: boolean
  completedDateTime?: { dateTime: string; timeZone: string } | null
  recurrence?: { pattern?: { type?: string; interval?: number; daysOfWeek?: string[] } } | null
  lastModifiedDateTime?: string
  '@removed'?: { reason: string }
}
export interface AppTask {
  id: string; list_id: string | null; title: string; notes: string | null; important: boolean
  due_on: string | null; remind_at: string | null; repeat_rule: Rule | null; completed_at: string | null; external_id: string | null
}

export const listKey = (listId: string) => `ms:${listId}`
export const taskKey = (listId: string, taskId: string) => `ms:${listId}:${taskId}`
export function parseTaskKey(ext: string | null) {
  if (!ext?.startsWith('ms:')) return null
  const [, listId, taskId] = ext.split(':')
  return listId && taskId ? { listId, taskId } : null
}

const WEEK = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const WEEKDAYS = WEEK.slice(1, 6)

export function ruleFromMs(rec: MsTask['recurrence']): Rule | null | undefined {
  const p = rec?.pattern
  if (!p?.type) return null
  if ((p.interval ?? 1) !== 1) return undefined
  if (p.type === 'daily') return 'daily'
  if (p.type === 'weekly') {
    const days = (p.daysOfWeek ?? []).map((d) => d.toLowerCase()).sort()
    if (days.length === 5 && WEEKDAYS.every((d) => days.includes(d))) return 'weekdays'
    return days.length <= 1 ? 'weekly' : undefined
  }
  if (p.type === 'absoluteMonthly') return 'monthly'
  if (p.type === 'absoluteYearly') return 'yearly'
  return undefined // padrão que o app não tem: não mexe
}

export function ruleToMs(rule: Rule, dueYmd: string) {
  const d = new Date(dueYmd + 'T12:00:00Z')
  const range = { type: 'noEnd', startDate: dueYmd }
  switch (rule) {
    case 'daily': return { pattern: { type: 'daily', interval: 1 }, range }
    case 'weekdays': return { pattern: { type: 'weekly', interval: 1, daysOfWeek: WEEKDAYS, firstDayOfWeek: 'monday' }, range }
    case 'weekly': return { pattern: { type: 'weekly', interval: 1, daysOfWeek: [WEEK[d.getUTCDay()]], firstDayOfWeek: 'monday' }, range }
    case 'monthly': return { pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: d.getUTCDate() }, range }
    case 'yearly': return { pattern: { type: 'absoluteYearly', interval: 1, dayOfMonth: d.getUTCDate(), month: d.getUTCMonth() + 1 }, range }
  }
}

/** Tarefa do To Do → formato que o banco grava (sync_apply_ms). */
export function msToApp(t: MsTask, listId: string, isDefault: boolean, tz: string) {
  const due = graphDate(t.dueDateTime)
  const rem = t.isReminderOn ? graphDate(t.reminderDateTime) : null
  const done = t.status === 'completed' ? (graphDate(t.completedDateTime) ?? new Date(t.lastModifiedDateTime ?? Date.now())) : null
  const rule = ruleFromMs(t.recurrence)
  const notes = (t.body?.content ?? '').trim()
  return {
    external_id: taskKey(listId, t.id),
    list_external_id: isDefault ? null : listKey(listId),
    title: (t.title || '(sem título)').slice(0, 300),
    notes: notes ? notes.slice(0, 5000) : null,
    important: t.importance === 'high',
    due_on: due ? ymdIn(due, tz) : null,
    remind_at: rem ? rem.toISOString() : null,
    completed_at: done ? done.toISOString() : null,
    ...(rule === undefined ? {} : { repeat_rule: rule }),
    modified_at: t.lastModifiedDateTime ?? new Date().toISOString(),
  }
}

const utcPlain = (iso: string) => new Date(iso).toISOString().replace('Z', '')

/** Tarefa do app → corpo para criar/editar no To Do. */
export function appToMs(t: AppTask, todayYmd: string) {
  const body: Record<string, unknown> = {
    title: t.title,
    status: t.completed_at ? 'completed' : 'notStarted',
    importance: t.important ? 'high' : 'normal',
    body: { content: t.notes ?? '', contentType: 'text' },
    // meio-dia em UTC: o dia não muda em nenhum fuso de -11h a +11h
    dueDateTime: t.due_on || t.repeat_rule ? { dateTime: `${t.due_on ?? todayYmd}T12:00:00`, timeZone: 'UTC' } : null,
    isReminderOn: !!t.remind_at,
    reminderDateTime: t.remind_at ? { dateTime: utcPlain(t.remind_at), timeZone: 'UTC' } : null,
  }
  if (t.completed_at) body.completedDateTime = { dateTime: utcPlain(t.completed_at), timeZone: 'UTC' }
  if (t.repeat_rule) body.recurrence = ruleToMs(t.repeat_rule, t.due_on ?? todayYmd)
  return body
}

export async function refreshMicrosoft(clientId: string, clientSecret: string, refreshToken: string) {
  const r = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token', scope: MS_SCOPE }),
  })
  const j = await r.json()
  if (!r.ok) throw new Error(j.error === 'invalid_grant' ? 'A Microsoft desligou o acesso. Ligue de novo em Configurações.' : `Microsoft token ${r.status}: ${j.error_description?.slice(0, 160) ?? ''}`)
  return { access: j.access_token as string, refresh: (j.refresh_token as string | undefined) ?? refreshToken }
}

/** Chamada ao Graph com o fuso em UTC; 404 vira null. */
export async function graph<T>(token: string, method: string, pathOrUrl: string, body?: unknown): Promise<T | null> {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : GRAPH + pathOrUrl
  const r = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Prefer: 'outlook.timezone="UTC", outlook.body-content-type="text"' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (r.status === 404) return null
  if (r.status === 204) return {} as T
  if (!r.ok) {
    const txt = await r.text()
    const err = new Error(`Microsoft ${method} ${r.status}: ${txt.slice(0, 200)}`) as Error & { status?: number }
    err.status = r.status
    throw err
  }
  return r.json() as Promise<T>
}
