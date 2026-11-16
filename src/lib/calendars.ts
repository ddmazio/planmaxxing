import { useMemo } from 'react'
import { DEMO, insert, update } from './db'
import { useRows } from './hooks'
import type { Area, Calendar, CalEvent, Integration } from './types'

export const LOCAL_CAL = 'local'

/** Agenda de um evento: "gcal:<id da agenda>:<id do evento>" → "gcal:<id da agenda>"; os criados no app → "local". */
export function calKey(e: Pick<CalEvent, 'external_id'>) {
  const x = e.external_id
  if (!x || !x.startsWith('gcal:')) return LOCAL_CAL
  const parts = x.split(':')
  return `gcal:${parts[1]}`
}

export function useCalendars(areas: Area[]) {
  const { rows, error } = useRows<Calendar>('calendars', { order: { column: 'position' } })
  const cals = error ? [] : rows
  return useMemo(() => {
    const byKey = new Map(cals.map((c) => [c.external_id, c]))
    const visible = (e: CalEvent) => byKey.get(calKey(e))?.visible ?? true
    const paint = (e: CalEvent) => {
      const a = areas.find((x) => x.id === e.area_id)
      if (a) return { fg: `var(--${a.color}-ink)`, bg: `var(--${a.color}-bg)`, on: `var(--${a.color}-fg)` }
      const hex = byKey.get(calKey(e))?.color
      if (hex) return { fg: hex, bg: `color-mix(in srgb, ${hex} 24%, var(--bg-surface))`, on: 'var(--text-primary)' }
      return { fg: 'var(--neutro-ink)', bg: 'var(--neutro-bg)', on: 'var(--neutro-fg)' }
    }
    const local = byKey.get(LOCAL_CAL)
    const list: { key: string; name: string; color: string | null; visible: boolean; row?: Calendar }[] = [
      { key: LOCAL_CAL, name: 'Twelvefold', color: null, visible: local?.visible ?? true, row: local },
      ...cals.filter((c) => c.external_id !== LOCAL_CAL).map((c) => ({ key: c.external_id, name: c.name, color: c.color, visible: c.visible, row: c })),
    ]
    const toggle = async (key: string, v: boolean) => {
      const row = byKey.get(key)
      if (row) await update<Calendar>('calendars', row.id, { visible: v })
      else if (key === LOCAL_CAL) await insert<Calendar>('calendars', { external_id: LOCAL_CAL, name: 'Twelvefold', visible: v, position: -1 })
    }
    return { list, visible, paint, toggle, ready: !error }
  }, [cals, areas, error])
}

/** Agrupa eventos que se sobrepõem e dá a cada um uma coluna, como no Google Agenda. */
export function layoutDay(evs: CalEvent[], minMinutes = 28) {
  const items = evs
    .map((e) => ({ e, s: new Date(e.starts_at).getTime(), en: Math.max(new Date(e.ends_at).getTime(), new Date(e.starts_at).getTime() + minMinutes * 60000) }))
    .sort((a, b) => a.s - b.s || b.en - a.en)
  const out = new Map<string, { col: number; cols: number }>()
  let cluster: { id: string; col: number }[] = []
  let cols: number[] = []
  let clusterEnd = 0
  const flush = () => { for (const c of cluster) out.set(c.id, { col: c.col, cols: cols.length }); cluster = []; cols = [] }
  for (const it of items) {
    if (cluster.length && it.s >= clusterEnd) flush()
    let i = cols.findIndex((end) => end <= it.s)
    if (i < 0) { i = cols.length; cols.push(it.en) } else cols[i] = it.en
    cluster.push({ id: it.e.id, col: i })
    clusterEnd = Math.max(clusterEnd, it.en)
  }
  flush()
  return out
}

export const INTEGRATION_COLS = 'owner_id,provider,account_email,status,last_sync_at,last_error,created_at,can_write,two_way'

/** A ligação com o Google (se houver) e se dá para escrever lá. */
export function useGoogleLink(enabled = true) {
  const { rows } = useRows<Integration>('integrations', { columns: INTEGRATION_COLS, eq: { provider: 'google' } }, enabled && !DEMO)
  const g = rows[0] ?? null
  return { g, canWrite: !!g?.can_write, twoWay: !!(g?.can_write && g?.two_way) }
}
