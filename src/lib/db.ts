import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { get, set, del, keys } from 'idb-keyval'
import type { Query, TableName } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Sem chaves do Supabase o app roda em "modo demonstração": dados só neste aparelho (IndexedDB). */
export const DEMO = !url || !anon

export const supabase: SupabaseClient | null = DEMO
  ? null
  : createClient(url!, anon!, {
      auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })

type Row = Record<string, unknown> & { id: string }

// ---------------------------------------------------------------- invalidação simples por tabela
type Listener = () => void
const listeners = new Map<TableName, Set<Listener>>()
export function subscribe(table: TableName, fn: Listener) {
  if (!listeners.has(table)) listeners.set(table, new Set())
  listeners.get(table)!.add(fn)
  return () => listeners.get(table)!.delete(fn)
}
function notify(table: TableName) { listeners.get(table)?.forEach((fn) => fn()) }

// ---------------------------------------------------------------- filtro local
function match(row: Row, q?: Query) {
  if (!q) return true
  for (const [k, v] of Object.entries(q.eq ?? {})) if ((row[k] ?? null) !== v) return false
  for (const [k, v] of Object.entries(q.gte ?? {})) if (!(row[k] != null && (row[k] as string) >= (v as string))) return false
  for (const [k, v] of Object.entries(q.lt ?? {})) if (!(row[k] != null && (row[k] as string) < (v as string))) return false
  return true
}
function sortRows<T extends Row>(rows: T[], q?: Query) {
  if (!q?.order) return rows
  const { column, ascending = true } = q.order
  return [...rows].sort((a, b) => {
    const x = a[column] as string | number, y = b[column] as string | number
    if (x === y) return 0
    if (x == null) return 1
    if (y == null) return -1
    return (x < y ? -1 : 1) * (ascending ? 1 : -1)
  })
}

const LOCAL_PREFIX = 'db:'
async function localAll(table: TableName): Promise<Row[]> { return ((await get(LOCAL_PREFIX + table)) as Row[]) ?? [] }
async function localSave(table: TableName, rows: Row[]) { await set(LOCAL_PREFIX + table, rows) }
const now = () => new Date().toISOString()
const uuid = () => crypto.randomUUID()

// ---------------------------------------------------------------- API única
export async function select<T>(table: TableName, q?: Query): Promise<T[]> {
  if (DEMO) return sortRows((await localAll(table)).filter((r) => match(r, q)), q) as unknown as T[]
  let req = supabase!.from(table).select('*')
  for (const [k, v] of Object.entries(q?.eq ?? {})) req = v === null ? req.is(k, null) : req.eq(k, v)
  for (const [k, v] of Object.entries(q?.gte ?? {})) req = req.gte(k, v)
  for (const [k, v] of Object.entries(q?.lt ?? {})) req = req.lt(k, v)
  if (q?.order) req = req.order(q.order.column, { ascending: q.order.ascending ?? true })
  const { data, error } = await req.limit(2000)
  if (error) throw error
  return data as T[]
}

export async function insert<T>(table: TableName, values: Partial<T>): Promise<T> {
  if (DEMO) {
    const rows = await localAll(table)
    const row = { id: uuid(), created_at: now(), updated_at: now(), owner_id: 'demo', ...values } as unknown as Row
    rows.push(row); await localSave(table, rows); notify(table)
    return row as unknown as T
  }
  const { data, error } = await supabase!.from(table).insert(values as never).select().single()
  if (error) throw error
  notify(table)
  return data as T
}

export async function update<T>(table: TableName, id: string, patch: Partial<T>): Promise<T> {
  if (DEMO) {
    const rows = await localAll(table)
    const i = rows.findIndex((r) => r.id === id)
    if (i < 0) throw new Error('not found')
    rows[i] = { ...rows[i], ...patch, updated_at: now() } as Row
    await localSave(table, rows); notify(table)
    return rows[i] as unknown as T
  }
  const { data, error } = await supabase!.from(table).update(patch as never).eq('id', id).select().single()
  if (error) throw error
  notify(table)
  return data as T
}

export async function remove(table: TableName, id: string): Promise<void> {
  if (DEMO) {
    await localSave(table, (await localAll(table)).filter((r) => r.id !== id))
    if (table === 'tasks') await localSave('task_items', (await localAll('task_items')).filter((r) => r.task_id !== id))
    if (table === 'lists') await localSave('tasks', (await localAll('tasks')).filter((r) => r.list_id !== id))
    notify(table)
    return
  }
  const { error } = await supabase!.from(table).delete().eq('id', id)
  if (error) throw error
  notify(table)
}

/** Exporta tudo o que é seu (para o botão "Exportar tudo"). */
export async function exportAll(): Promise<Record<string, unknown[]>> {
  const tables: TableName[] = ['profiles', 'areas', 'lists', 'tasks', 'task_items', 'events', 'habits', 'habit_logs', 'cycles', 'goals', 'steps', 'reflections', 'incomes', 'expenses', 'pots', 'subscriptions', 'budget_rules', 'groups', 'group_members', 'checkins']
  const out: Record<string, unknown[]> = {}
  for (const t of tables) out[t] = await select(t)
  return out
}

export async function wipeLocal() { for (const k of await keys()) if (String(k).startsWith(LOCAL_PREFIX)) await del(k) }

/** Apaga linhas por filtro (para tabelas sem id, como list_members). */
export async function removeWhere(table: TableName, eq: Record<string, string>): Promise<void> {
  if (DEMO) {
    await localSave(table, (await localAll(table)).filter((r) => !Object.entries(eq).every(([k, v]) => r[k] === v)))
    notify(table); return
  }
  let req = supabase!.from(table).delete()
  for (const [k, v] of Object.entries(eq)) req = req.eq(k, v)
  const { error } = await req
  if (error) throw error
  notify(table)
}

/** Insere linha em tabela sem coluna id (list_members). */
export async function insertPlain(table: TableName, values: Record<string, unknown>): Promise<void> {
  if (DEMO) { const rows = await localAll(table); rows.push({ id: uuid(), ...values } as Row); await localSave(table, rows); notify(table); return }
  const { error } = await supabase!.from(table).insert(values as never)
  if (error) throw error
  notify(table)
}

/** Atualiza linhas por filtro (group_members). */
export async function updateWhere(table: TableName, eq: Record<string, string>, patch: Record<string, unknown>): Promise<void> {
  if (DEMO) {
    const rows = (await localAll(table)).map((r) => (Object.entries(eq).every(([k, v]) => r[k] === v) ? { ...r, ...patch } : r))
    await localSave(table, rows as Row[]); notify(table); return
  }
  let req = supabase!.from(table).update(patch as never)
  for (const [k, v] of Object.entries(eq)) req = req.eq(k, v)
  const { error } = await req
  if (error) throw error
  notify(table)
}

/** Regra do orçamento: uma linha por pessoa (chave = owner_id). */
export async function saveRule(rule: { needs_pct: number; wants_pct: number; savings_pct: number }): Promise<void> {
  if (DEMO) { await localSave('budget_rules', [{ id: 'rule', ...rule }]); notify('budget_rules'); return }
  const { data } = await supabase!.auth.getUser()
  if (!data.user) throw new Error('not authenticated')
  const { error } = await supabase!.from('budget_rules').upsert({ owner_id: data.user.id, ...rule })
  if (error) throw error
  notify('budget_rules')
}

/** Chama uma função do banco (RPC). Indisponível no modo demonstração. */
export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  if (DEMO) throw new Error('Disponível só com a conta online.')
  const { data, error } = await supabase!.rpc(fn, args)
  if (error) throw error
  return data as T
}

export function touch(table: TableName) { notify(table) }
