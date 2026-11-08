import { useCallback, useEffect, useRef, useState } from 'react'
import { select, subscribe } from './db'
import type { Query, TableName } from './types'

/** Lê linhas de uma tabela e recarrega sozinho quando algo nessa tabela muda. */
export function useRows<T>(table: TableName, q?: Query, enabled = true) {
  const key = JSON.stringify(q ?? {})
  const [rows, setRows] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const alive = useRef(true)
  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const data = await select<T>(table, q)
      if (alive.current) { setRows(data); setError(null) }
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : 'Erro ao carregar')
    } finally {
      if (alive.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [table, key, enabled])
  useEffect(() => {
    alive.current = true
    load()
    const off = subscribe(table, load)
    return () => { alive.current = false; off() }
  }, [load, table])
  return { rows, loading, error, reload: load }
}

export function useToast() {
  const [msg, setMsg] = useState<string | null>(null)
  useEffect(() => { if (!msg) return; const t = setTimeout(() => setMsg(null), 2600); return () => clearTimeout(t) }, [msg])
  return { msg, show: setMsg }
}
