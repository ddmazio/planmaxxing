/** Acesso ao banco pelo servidor (service_role), sem dependências. */
export function makeDb(url: string, key: string) {
  // chave nova (sb_secret_…) vai só no apikey; a antiga (JWT) vai nos dois
  const h: Record<string, string> = key.startsWith('sb_') ? { apikey: key, 'Content-Type': 'application/json' } : { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
  const call = async (method: string, path: string, body?: unknown, extra: Record<string, string> = {}) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: { ...h, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) })
    const t = await r.text()
    if (!r.ok) throw new Error(`db ${method} ${path.split('?')[0]} ${r.status}: ${t.slice(0, 300)}`)
    return t ? JSON.parse(t) : null
  }
  return {
    rpc: <T = unknown>(fn: string, args: Record<string, unknown>) => call('POST', `rpc/${fn}`, args) as Promise<T>,
    get: <T = unknown>(path: string) => call('GET', path) as Promise<T>,
    /** Lê tudo, em páginas de 1000. */
    getAll: async <T = unknown>(path: string) => {
      const out: T[] = []
      for (let from = 0; ; from += 1000) {
        const page = (await call('GET', path, undefined, { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' })) as T[]
        out.push(...page)
        if (page.length < 1000) return out
      }
    },
    upsert: (table: string, rows: unknown[], onConflict: string) =>
      call('POST', `${table}?on_conflict=${onConflict}`, rows, { Prefer: 'resolution=merge-duplicates,return=minimal' }),
    insert: (table: string, rows: unknown[]) => call('POST', table, rows, { Prefer: 'return=minimal' }),
    patch: (path: string, body: unknown) => call('PATCH', path, body, { Prefer: 'return=minimal' }),
    del: (path: string) => call('DELETE', path, undefined, { Prefer: 'return=minimal' }),
  }
}
export type Db = ReturnType<typeof makeDb>

/** Lista para filtros in.(...) do PostgREST, com aspas (ids do Google têm # e @). */
export const inList = (xs: string[]) => `(${xs.map((x) => `"${x.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`

/** Chaves do projeto, no formato antigo ou no novo (o Supabase injeta as duas nas funções). */
export function projectKeys(env: (k: string) => string) {
  const pick = (json: string) => { try { const o = JSON.parse(json); return (o.default ?? Object.values(o)[0] ?? '') as string } catch { return '' } }
  return {
    service: env('SUPABASE_SERVICE_ROLE_KEY') || pick(env('SUPABASE_SECRET_KEYS')),
    anon: env('SUPABASE_ANON_KEY') || pick(env('SUPABASE_PUBLISHABLE_KEYS')),
  }
}
