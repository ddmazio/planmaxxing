/** Quais avisos estão na hora, para cada pessoa (lógica pura, testada em notify.test.ts). */
import { ymdIn, zonedIso } from './time.ts'

export interface Prefs {
  plan: { on: boolean; time: string }; close: { on: boolean; time: string }; checkin: { on: boolean; before: number }
  morning: { on: boolean; time: string }; habits: { on: boolean }; events: { on: boolean }
  cheers: { on: boolean }; scores: { on: boolean }; quiet: { on: boolean; from: string; to: string }
}
export const DEFAULT_PREFS: Prefs = {
  plan: { on: true, time: '18:00' }, close: { on: true, time: '20:30' }, checkin: { on: true, before: 15 },
  morning: { on: true, time: '08:00' }, habits: { on: true }, events: { on: true },
  cheers: { on: true }, scores: { on: false }, quiet: { on: true, from: '23:00', to: '07:30' },
}
export function prefsOf(raw: unknown): Prefs {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof Prefs, object>>
  const out = { ...DEFAULT_PREFS } as Record<string, unknown>
  for (const k of Object.keys(DEFAULT_PREFS) as (keyof Prefs)[]) out[k] = { ...DEFAULT_PREFS[k], ...(r[k] ?? {}) }
  return out as unknown as Prefs
}

export interface Person { id: string; timezone: string; notify: unknown }
export interface Data {
  cycles: { owner_id: string; starts_on: string }[]
  steps: { owner_id: string; week: number; starts_on: string; done_at: string | null }[] // passos do ciclo ativo, com a data de início do ciclo
  habits: { id: string; owner_id: string; title: string; days: number[]; reminder_time: string | null }[]
  events: { id: string; owner_id: string; title: string; starts_at: string; all_day: boolean; reminder_minutes: number | null }[]
  tasks: { id: string; owner_id: string; title: string; remind_at: string }[]
  groups: { user_id: string; group_id: string; name: string; checkin_weekday: number }[]
  cheers: { id: string; to_id: string; from_name: string; created_at: string }[]
  checkins: { id: string; group_id: string; owner_id: string; owner_name: string; score: number | null; created_at: string; visible: boolean }[]
}
export interface Out { owner: string; kind: string; key: string; title: string; body?: string; url: string; strong?: boolean }

const WINDOW = 10 * 60000
const inWindow = (iso: string, now: number) => { const t = Date.parse(iso); return t <= now && t > now - WINDOW }
const hm = (d: Date, tz: string) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d)
const dow = (ymd: string) => new Date(ymd + 'T12:00:00Z').getUTCDay()
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
export function inQuiet(p: Prefs, at: Date, tz: string) {
  if (!p.quiet.on) return false
  const n = toMin(hm(at, tz)), a = toMin(p.quiet.from), b = toMin(p.quiet.to)
  return a <= b ? n >= a && n < b : n >= a || n < b
}

export function due(people: Person[], d: Data, nowMs = Date.now()): Out[] {
  const out: Out[] = []
  const now = new Date(nowMs)
  for (const person of people) {
    const tz = person.timezone || 'Europe/Lisbon'
    const p = prefsOf(person.notify)
    const today = ymdIn(now, tz)
    const wd = dow(today)
    const at = (time: string, day = today) => zonedIso(day, time.slice(0, 5), tz)
    const cyc = d.cycles.find((c) => c.owner_id === person.id)
    const week = cyc ? Math.floor((Date.parse(today) - Date.parse(cyc.starts_on)) / (7 * 864e5)) + 1 : null
    const quiet = inQuiet(p, now, tz)
    const push = (o: Omit<Out, 'owner'>) => { if (!quiet || o.strong) out.push({ owner: person.id, ...o }) }

    if (wd === 0 && p.plan.on && inWindow(at(p.plan.time), nowMs))
      push({ kind: 'plan', key: today, title: week && week < 12 ? `Vamos planejar a semana ${week + 1}?` : 'Vamos planejar a semana?', body: 'Uns 10 minutos: o que ficou para trás, a sua semana e a agenda.', url: '/ciclo/ritual' })
    if (wd === 0 && p.close.on && inWindow(at(p.close.time), nowMs))
      push({ kind: 'close', key: today, title: week && week <= 12 ? `Hora de fechar a semana ${week}` : 'Hora de fechar a semana', body: 'Veja o seu placar e faça o check-in.', url: '/ciclo/ritual' })

    if (p.morning.on && inWindow(at(p.morning.time), nowMs)) {
      const steps = week ? d.steps.filter((s) => s.owner_id === person.id && s.week === week && !s.done_at).length : 0
      const habits = d.habits.filter((h) => h.owner_id === person.id && h.days.includes(wd)).length
      const first = d.events.filter((e) => e.owner_id === person.id && !e.all_day && ymdIn(new Date(e.starts_at), tz) === today && Date.parse(e.starts_at) > nowMs)
        .sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0]
      const parts = [steps && `${steps} passo${steps === 1 ? '' : 's'}`, habits && `${habits} hábito${habits === 1 ? '' : 's'}`].filter(Boolean)
      push({ kind: 'morning', key: today, title: 'Bom dia', body: [parts.length ? `${parts.join(' e ')} hoje.` : 'Dia livre no plano.', first && `Primeiro bloco: ${first.title} às ${hm(new Date(first.starts_at), tz)}.`].filter(Boolean).join(' '), url: '/' })
    }

    if (p.habits.on) for (const h of d.habits.filter((x) => x.owner_id === person.id && x.reminder_time && x.days.includes(wd)))
      if (inWindow(at(h.reminder_time!), nowMs)) push({ kind: 'habit', key: `${h.id}:${today}`, title: h.title, body: 'Hora do seu hábito.', url: `/habito/${h.id}` })

    if (p.events.on) for (const e of d.events.filter((x) => x.owner_id === person.id && x.reminder_minutes != null && !x.all_day)) {
      const t = new Date(Date.parse(e.starts_at) - e.reminder_minutes! * 60000).toISOString()
      if (inWindow(t, nowMs)) push({ kind: 'event', key: `${e.id}:${e.starts_at}`, title: e.title, body: e.reminder_minutes ? `Daqui a ${e.reminder_minutes} min, às ${hm(new Date(e.starts_at), tz)}.` : 'Agora.', url: `/agenda?evento=${e.id}`, strong: true })
    }
    for (const t of d.tasks.filter((x) => x.owner_id === person.id && inWindow(x.remind_at, nowMs)))
      push({ kind: 'task', key: `${t.id}:${t.remind_at}`, title: t.title, body: 'Lembrete da tarefa.', url: `/tarefa/${t.id}`, strong: true })

    if (p.checkin.on) for (const g of d.groups.filter((x) => x.user_id === person.id && x.checkin_weekday === wd))
      if (inWindow(new Date(Date.parse(at('09:00')) - p.checkin.before * 60000).toISOString(), nowMs))
        push({ kind: 'checkin', key: `${g.group_id}:${today}`, title: `Check-in do grupo ${g.name}`, body: p.checkin.before ? `Daqui a ${p.checkin.before} min. Como foi a semana?` : 'Como foi a semana?', url: '/grupo' })

    if (p.cheers.on) for (const c of d.cheers.filter((x) => x.to_id === person.id && inWindow(x.created_at, nowMs)))
      push({ kind: 'cheer', key: c.id, title: `${c.from_name} te mandou um incentivo 👏`, url: '/grupo' })

    if (p.scores.on) {
      const mine = new Set(d.groups.filter((g) => g.user_id === person.id).map((g) => g.group_id))
      for (const c of d.checkins.filter((x) => x.visible && x.owner_id !== person.id && mine.has(x.group_id) && inWindow(x.created_at, nowMs)))
        push({ kind: 'score', key: c.id, title: `${c.owner_name} fez o check-in${c.score != null ? `: ${c.score}%` : ''}`, url: '/grupo' })
    }
  }
  return out
}

