import { useEffect, useState } from 'react'
import { DEMO, rpc, supabase } from './db'

/** Configurações gerais do app (escritas só pela dona, lidas por todos). */
export interface AppSettings {
  announcement: string | null
  announcement_until: string | null
  announcement_at: string | null
  maintenance: boolean
  refresh_after: string | null
  default_weeks: number
}
export type Rollout = 'owner' | 'testers' | 'all'

/** Recursos que dá para liberar aos poucos: só a dona, testadores ou todos. */
export const FEATURES: { key: string; name: string; hint: string }[] = [
  { key: 'ciclo_curto', name: 'Ciclo com 4 ou 6 semanas', hint: 'Além de 8 e 12, a escolha de duração mostra 4 e 6 semanas.' },
  { key: 'arrastar_agenda', name: 'Arrastar na agenda', hint: 'Mudar o horário de um compromisso arrastando o bloco.' },
  { key: 'sugestao_agora', name: 'Sugestão do Agora', hint: 'No Hoje, propõe o próximo passo quando o horário está livre.' },
]

const DEFAULTS: AppSettings = { announcement: null, announcement_until: null, announcement_at: null, maintenance: false, refresh_after: null, default_weeks: 12 }
const DEMO_FEATURES = ['arrastar_agenda', 'sugestao_agora']

type State = { settings: AppSettings; features: string[]; ready: boolean }
let state: State = { settings: DEFAULTS, features: DEMO ? DEMO_FEATURES : [], ready: DEMO }
const subs = new Set<(s: State) => void>()
let loading: Promise<void> | null = null
let loadedAt = 0

async function load() {
  if (DEMO) return
  try {
    const [s, f] = await Promise.all([
      supabase!.from('app_settings').select('announcement,announcement_until,announcement_at,maintenance,refresh_after,default_weeks').maybeSingle(),
      rpc<string[]>('my_features'),
    ])
    state = { settings: { ...DEFAULTS, ...(s.data ?? {}) }, features: f ?? [], ready: true }
  } catch {
    // sem a tabela (antes de rodar o SQL) ou sem internet: segue com o padrão, com tudo o que já era de todos ligado
    state = { ...state, features: state.ready ? state.features : DEMO_FEATURES, ready: true }
  }
  loadedAt = Date.now()
  subs.forEach((fn) => fn(state))
}

/** Recarrega as configurações (depois que a dona muda algo, ou ao voltar ao app). */
export function refreshApp() { loading = load().finally(() => { loading = null }); return loading }

function ensure() { if (!loading && Date.now() - loadedAt > 5 * 60_000) refreshApp() }
if (typeof window !== 'undefined') window.addEventListener('focus', ensure)

export function useApp() {
  const [s, setS] = useState(state)
  useEffect(() => { subs.add(setS); ensure(); setS(state); return () => { subs.delete(setS) } }, [])
  return s
}

/** Este recurso está ligado para quem está usando? */
export function useFeature(key: string) { return useApp().features.includes(key) }
