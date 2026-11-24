import type { Area, AreaColor } from './types'

/** As áreas que o ritual oferece. A pessoa escolhe quais refletir; as dela que já existem também entram. */
export interface AreaPreset { key: string; name: string; color: AreaColor; icon: string; hint?: string; match: RegExp }
export const AREA_CATALOG: AreaPreset[] = [
  { key: 'trabalho', name: 'Trabalho', color: 'trabalho', icon: 'briefcase', match: /^trabalho|carreira|emprego/ },
  { key: 'estudos', name: 'Estudos', color: 'estudos', icon: 'book', match: /^estud|faculdade|cursos?$/ },
  { key: 'familia', name: 'Família', color: 'relacoes', icon: 'home', match: /^familia/ },
  { key: 'relacoes', name: 'Relações', color: 'relacoes', icon: 'users', hint: 'amizades, relacionamento e pessoas próximas', match: /^relac|^amizade|^amig|^namoro/ },
  { key: 'self', name: 'Self improvement', color: 'eu', icon: 'growth', match: /self|autodesenvolv|crescimento/ },
  { key: 'saude', name: 'Saúde', color: 'saude', icon: 'heart', hint: 'corpo, sono, alimentação, exercício', match: /^saude( fisica)?$|^corpo|^treino/ },
  { key: 'mental', name: 'Saúde mental', color: 'saude', icon: 'leaf', match: /saude mental|^mente/ },
  { key: 'financeiro', name: 'Financeiro', color: 'financas', icon: 'wallet', match: /^financ/ },
  { key: 'gratidao', name: 'Gratidão e felicidade', color: 'estudos', icon: 'smile', match: /gratid|felicidade/ },
  { key: 'application', name: 'Application', color: 'estudos', icon: 'cap', hint: 'candidaturas para mestrado ou graduação', match: /^application|candidatura/ },
]

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
/** Qual área da pessoa corresponde a uma do catálogo (pelo nome; Finanças é a área fixa). */
export function presetArea(p: AreaPreset, areas: Area[]) {
  return areas.find((a) => !a.archived && (p.match.test(norm(a.name)) || (p.key === 'financeiro' && a.is_fixed)))
}

/** Áreas que aparecem no menu e nos painéis: as de foco do ciclo e Finanças. Sem foco marcado, todas. */
export function shownAreas(areas: Area[]) {
  const live = areas.filter((a) => !a.archived)
  return live.some((a) => a.focus) ? live.filter((a) => a.focus || a.is_fixed) : live
}
/** As que não são de foco (vão para "Outras áreas"). */
export function otherAreas(areas: Area[]) {
  const live = areas.filter((a) => !a.archived)
  return live.some((a) => a.focus) ? live.filter((a) => !a.focus && !a.is_fixed) : []
}
