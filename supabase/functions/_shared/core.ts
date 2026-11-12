/** Lógica das sincronizações. Recebe o banco já autenticado como servidor. */
import { type Db, inList } from './rest.ts'
import { calendarRow, eventKey, listCalendars, listEvents, toRow } from './google.ts'
import { type AppTask, type MsList, type MsTask, appToMs, graph, listKey, msToApp, parseTaskKey, taskKey } from './microsoft.ts'
import { ymdIn } from './time.ts'

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n))
const DAY = 864e5

// ---------------------------------------------------------------- Google Agenda (só leitura)
export async function syncGoogle(db: Db, owner: string, tz: string, access: string, last: { last_sync_at: string | null; last_full_sync_at: string | null }, forceFull = false) {
  const now = Date.now()
  const cals = await listCalendars(access)

  // agendas: novas entram como no Google; as que já existem mantêm a escolha de mostrar/esconder
  const existing = await db.getAll<{ id: string; external_id: string; name: string; color: string | null; position: number }>(
    `calendars?select=id,external_id,name,color,position&owner_id=eq.${owner}&external_id=like.gcal:*`)
  const seen = new Set<string>()
  const fresh: unknown[] = []
  for (const [i, c] of cals.entries()) {
    const row = calendarRow(c, i)
    seen.add(row.external_id)
    const ex = existing.find((x) => x.external_id === row.external_id)
    if (!ex) fresh.push({ owner_id: owner, ...row })
    else if (ex.name !== row.name || ex.color !== row.color || ex.position !== row.position)
      await db.patch(`calendars?id=eq.${ex.id}`, { name: row.name, color: row.color, position: row.position })
  }
  if (fresh.length) await db.insert('calendars', fresh)
  const gone = existing.filter((x) => !seen.has(x.external_id)).map((x) => x.id)
  if (gone.length) await db.del(`calendars?id=in.(${gone.join(',')})`)

  const timeMin = new Date(now - 31 * DAY).toISOString()
  const timeMax = new Date(now + 365 * DAY).toISOString()
  const full = forceFull || !last.last_sync_at || !last.last_full_sync_at || now - Date.parse(last.last_full_sync_at) > DAY
  const updatedMin = full ? undefined : new Date(Date.parse(last.last_sync_at!) - 10 * 60000).toISOString()

  const rows: Record<string, unknown>[] = []
  const cancelled: string[] = []
  for (const c of cals) {
    for (const e of await listEvents(access, c, timeMin, timeMax, updatedMin)) {
      if (e.status === 'cancelled') { cancelled.push(eventKey(c.id, e.id)); continue }
      const r = toRow(e, c, tz)
      if (r) rows.push({ owner_id: owner, ...r })
    }
  }
  for (const part of chunks(rows, 500)) await db.upsert('events', part, 'owner_id,external_id')
  for (const part of chunks(cancelled, 80)) await db.del(`events?owner_id=eq.${owner}&external_id=in.${encodeURIComponent(inList(part))}`)

  let removed = cancelled.length
  if (full) {
    // reconciliação diária: o que sumiu do Google (inclusive de agendas apagadas) sai daqui
    const keep = new Set(rows.map((r) => r.external_id as string))
    const have = await db.getAll<{ id: string; external_id: string }>(
      `events?select=id,external_id&owner_id=eq.${owner}&external_id=like.gcal:*&starts_at=gte.${encodeURIComponent(timeMin)}&starts_at=lt.${encodeURIComponent(timeMax)}`)
    const stale = have.filter((e) => !keep.has(e.external_id)).map((e) => e.id)
    for (const part of chunks(stale, 100)) await db.del(`events?id=in.(${part.join(',')})`)
    removed += stale.length
  }
  return { full, saved: rows.length, removed, calendars: cals.length }
}

// ---------------------------------------------------------------- Microsoft To Do (nos dois sentidos)
export interface MsState { defaultList?: string; lists?: string[]; delta?: Record<string, string>; linked?: boolean }

async function graphAll<T>(token: string, path: string) {
  const out: T[] = []
  let next: string | undefined = path
  while (next) {
    const page: { value: T[]; '@odata.nextLink'?: string } | null = await graph(token, 'GET', next)
    if (!page) break
    out.push(...page.value); next = page['@odata.nextLink']
  }
  return out
}

const TASK_COLS = 'id,list_id,title,notes,important,due_on,remind_at,repeat_rule,completed_at,external_id'

async function msListOf(db: Db, t: Pick<AppTask, 'list_id'>, state: MsState) {
  if (!t.list_id) return state.defaultList ?? null
  const [l] = await db.get<{ external_id: string | null }[]>(`lists?select=external_id&id=eq.${t.list_id}`)
  return l?.external_id?.startsWith('ms:') ? l.external_id.slice(3) : null
}

async function pushTask(db: Db, access: string, state: MsState, t: AppTask, today: string) {
  const target = await msListOf(db, t, state)
  if (!target) return
  const cur = parseTaskKey(t.external_id)
  const body = appToMs(t, today)
  if (cur && cur.listId === target) {
    const ok = await graph(access, 'PATCH', `/me/todo/lists/${target}/tasks/${cur.taskId}`, body)
    if (ok) return
  }
  const created = await graph<MsTask>(access, 'POST', `/me/todo/lists/${target}/tasks`, body)
  if (!created) return
  await db.rpc('sync_link', { p_kind: 'task', p_id: t.id, p_external: taskKey(target, created.id) })
  if (cur && cur.listId !== target) await graph(access, 'DELETE', `/me/todo/lists/${cur.listId}/tasks/${cur.taskId}`)
}

async function pushList(db: Db, access: string, l: { id: string; name: string; external_id: string | null }) {
  if (l.external_id?.startsWith('ms:')) {
    const ok = await graph(access, 'PATCH', `/me/todo/lists/${l.external_id.slice(3)}`, { displayName: l.name })
    if (ok) return
  }
  const created = await graph<MsList>(access, 'POST', '/me/todo/lists', { displayName: l.name })
  if (created) await db.rpc('sync_link', { p_kind: 'list', p_id: l.id, p_external: listKey(created.id) })
}

interface OutItem { id: number; kind: 'task' | 'list'; op: 'upsert' | 'delete'; entity_id: string; external_id: string | null }

/** Envia ao To Do o que mudou no app (fila preenchida pelo gatilho do banco). */
export async function pushOutbox(db: Db, owner: string, access: string, state: MsState, today: string) {
  let sent = 0
  for (let round = 0; round < 10; round++) {
    const items = await db.rpc<OutItem[]>('sync_take_outbox', { p_owner: owner, p_limit: 200 })
    if (!items?.length) break
    // fica só a última operação de cada item
    const last = new Map<string, OutItem>()
    for (const it of items) last.set(`${it.kind}:${it.entity_id}`, { ...it, external_id: it.external_id ?? last.get(`${it.kind}:${it.entity_id}`)?.external_id ?? null })
    const all = [...last.values()]
    const deletedLists = new Set(all.filter((x) => x.kind === 'list' && x.op === 'delete' && x.external_id).map((x) => x.external_id!.slice(3)))
    const order = (x: OutItem) => (x.kind === 'list' && x.op === 'upsert' ? 0 : x.kind === 'task' && x.op === 'upsert' ? 1 : x.kind === 'task' ? 2 : 3)
    for (const it of all.sort((a, b) => order(a) - order(b))) {
      try {
        if (it.kind === 'list' && it.op === 'upsert') {
          const [l] = await db.get<{ id: string; name: string; external_id: string | null }[]>(`lists?select=id,name,external_id&id=eq.${it.entity_id}`)
          if (l) await pushList(db, access, l)
        } else if (it.kind === 'task' && it.op === 'upsert') {
          const [t] = await db.get<AppTask[]>(`tasks?select=${TASK_COLS}&id=eq.${it.entity_id}`)
          if (t) await pushTask(db, access, state, t, today)
        } else if (it.kind === 'task') {
          const k = parseTaskKey(it.external_id)
          if (k && !deletedLists.has(k.listId)) await graph(access, 'DELETE', `/me/todo/lists/${k.listId}/tasks/${k.taskId}`)
        } else if (it.external_id?.startsWith('ms:') && it.external_id.slice(3) !== state.defaultList) {
          await graph(access, 'DELETE', `/me/todo/lists/${it.external_id.slice(3)}`)
        }
        sent++
      } catch (e) {
        const status = (e as { status?: number }).status
        if (status === 401 || status === 403) throw e
        console.error('push', it.kind, it.op, (e as Error).message)
      }
    }
  }
  return sent
}

/** Puxa do To Do o que mudou (delta por lista) e grava no app. */
export async function syncMicrosoft(db: Db, owner: string, tz: string, access: string, state: MsState) {
  const today = ymdIn(new Date(), tz)
  const lists = (await graphAll<MsList>(access, '/me/todo/lists')).filter((l) => l.wellknownListName !== 'flaggedEmails')
  const def = lists.find((l) => l.wellknownListName === 'defaultList')
  state.defaultList = def?.id
  state.delta ??= {}

  // 1. o que mudou no app vai primeiro
  const sent = state.linked ? await pushOutbox(db, owner, access, state, today) : 0

  // 2. listas do To Do (a "Tarefas" padrão é a Inbox do app)
  const removed: string[] = (state.lists ?? []).filter((id) => !lists.some((l) => l.id === id)).map(listKey)
  const listRows = lists.filter((l) => l.id !== def?.id).map((l, i) => ({ external_id: listKey(l.id), name: l.displayName.slice(0, 60), position: i }))
  await db.rpc('sync_apply_ms', { p_owner: owner, p_lists: listRows, p_tasks: [], p_removed: removed })
  for (const id of state.lists ?? []) if (!lists.some((l) => l.id === id)) delete state.delta[id]

  // 3. tarefas que mudaram, lista por lista
  const tasks: ReturnType<typeof msToApp>[] = []
  for (const l of lists) {
    let link: string | undefined = state.delta[l.id] ?? `/me/todo/lists/${l.id}/tasks/delta`
    for (let reset = 0; link; ) {
      let page: { value: MsTask[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string } | null
      try { page = await graph(access, 'GET', link) } catch (e) {
        if (((e as { status?: number }).status === 410 || /syncStateNotFound|resync/i.test((e as Error).message)) && reset++ === 0) { link = `/me/todo/lists/${l.id}/tasks/delta`; continue }
        throw e
      }
      if (!page) break
      for (const t of page.value) {
        if (t['@removed']) { removed.push(taskKey(l.id, t.id)); continue }
        const row = msToApp(t, l.id, l.id === def?.id, tz)
        // na primeira ligação, o histórico antigo de concluídas fica só no To Do
        if (!state.linked && row.completed_at && Date.now() - Date.parse(row.completed_at) > 60 * DAY) continue
        tasks.push(row)
      }
      if (page['@odata.nextLink']) link = page['@odata.nextLink']
      else { if (page['@odata.deltaLink']) state.delta[l.id] = page['@odata.deltaLink']; link = undefined }
    }
  }

  // 4. na primeira vez, liga tarefas iguais (mesma lista e título) em vez de duplicar
  if (!state.linked && tasks.length) {
    const appLists = await db.getAll<{ id: string; external_id: string | null }>(`lists?select=id,external_id&owner_id=eq.${owner}`)
    const appTasks = await db.getAll<{ id: string; title: string; list_id: string | null }>(`tasks?select=id,title,list_id&owner_id=eq.${owner}&external_id=is.null`)
    const used = new Set<string>()
    for (const t of tasks) {
      const listId = t.list_external_id ? appLists.find((l) => l.external_id === t.list_external_id)?.id ?? 'x' : null
      const m = appTasks.find((a) => !used.has(a.id) && a.list_id === listId && a.title.trim().toLowerCase() === t.title.trim().toLowerCase())
      if (m) { used.add(m.id); await db.rpc('sync_link', { p_kind: 'task', p_id: m.id, p_external: t.external_id }) }
    }
  }
  for (const part of chunks(tasks, 300)) await db.rpc('sync_apply_ms', { p_owner: owner, p_lists: [], p_tasks: part, p_removed: [] })
  if (removed.length) await db.rpc('sync_apply_ms', { p_owner: owner, p_lists: [], p_tasks: [], p_removed: removed })
  state.lists = lists.map((l) => l.id)

  // 5. na primeira vez, manda para o To Do o que só existe no app (listas e tarefas abertas)
  let created = 0
  if (!state.linked) {
    const mine = await db.getAll<{ id: string; name: string; external_id: string | null }>(`lists?select=id,name,external_id&owner_id=eq.${owner}&external_id=is.null`)
    for (const l of mine) { await pushList(db, access, l); created++ }
    const open = await db.getAll<AppTask>(`tasks?select=${TASK_COLS}&owner_id=eq.${owner}&external_id=is.null&completed_at=is.null&step_id=is.null`)
    for (const t of open) { await pushTask(db, access, state, t, today); created++ }
    state.linked = true
    // o que entrou na fila durante a primeira ligação já foi enviado aqui
    await db.rpc('sync_take_outbox', { p_owner: owner, p_limit: 10000 })
  }
  return { sent, received: tasks.length, removed: removed.length, created }
}
