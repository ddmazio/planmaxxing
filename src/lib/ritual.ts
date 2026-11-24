import { useRows } from './hooks'
import type { Reflection } from './types'

/** As etapas do ritual de novo ciclo, na ordem. */
export const RITUAL_P1 = ['areas', 'reflexao']
export const RITUAL_P2 = ['foco', 'tipos', 'recompensas', 'palavras', 'metas']
export const RITUAL_P3 = ['datas', 'ideias', 'distribuir']
export const RITUAL_ORDER = ['inicio', ...RITUAL_P1, ...RITUAL_P2, ...RITUAL_P3]
export const RITUAL_NAMES: Record<string, string> = {
  inicio: 'Início', areas: 'Escolher áreas', reflexao: 'Refletir', foco: 'Foco', tipos: 'Hábito, projeto, mix', recompensas: 'Recompensas', palavras: '3 palavras', metas: 'Metas e projetos',
  datas: 'Datas do ciclo', ideias: 'Ideias', distribuir: 'Revisar e distribuir',
}

/** Um ritual de novo ciclo começado e não terminado (guardado numa reflexão), com onde parou. */
export function useRitualDraft() {
  const { rows } = useRows<Reflection>('reflections', { eq: { kind: 'reset' } })
  for (const r of rows) {
    if (r.prompt !== 'ritual-trimestre') continue
    try {
      const j = JSON.parse(r.answers[0] ?? '{}') as { v?: number; finished?: boolean; step?: number; focus?: string[]; reflect?: string[] }
      if (j.v !== 2 || j.finished) continue
      const step = j.step ?? 0
      const id = RITUAL_ORDER[step] ?? 'inicio'
      const part = RITUAL_P1.includes(id) ? 1 : RITUAL_P2.includes(id) ? 2 : RITUAL_P3.includes(id) ? 3 : 0
      return { row: r, step, name: RITUAL_NAMES[id], part, updated: r.updated_at ?? r.created_at ?? null }
    } catch { /* ignora o que não dá para ler */ }
  }
  return null
}
