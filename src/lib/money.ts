/** Formata centavos na moeda do perfil, com o símbolo antes (ex.: € 12,50, € 1.500,00, R$ 1.850,00). */
export function money(cents: number, currency = 'EUR', locale = 'pt-BR') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}
export const CURRENCIES: [string, string][] = [
  ['EUR', 'Euro (€)'], ['BRL', 'Real brasileiro (R$)'], ['USD', 'Dólar americano ($)'], ['GBP', 'Libra esterlina (£)'],
  ['CHF', 'Franco suíço'], ['CAD', 'Dólar canadiano'], ['AUD', 'Dólar australiano'], ['JPY', 'Iene'],
]

/** "12,50" ou "1.234,56" ou "12.5" → centavos. null se inválido. */
export function parseMoney(s: string): number | null {
  let t = s.trim().replace(/\s|€|R\$|\$|£/g, '')
  if (!t) return null
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null
  const n = Math.round(parseFloat(t) * 100)
  return n >= 0 && n <= 100000000000 ? n : null
}

/** Valor sem o símbolo, para preencher campos: 1250 → "12,50". */
export const centsToInput = (c: number) => (c / 100).toFixed(2).replace('.', ',')

/** Símbolo e país de cada moeda, para a escolha de moeda. */
export const CURRENCY_INFO: Record<string, { symbol: string; name: string; where: string }> = {
  EUR: { symbol: '€', name: 'Euro', where: 'Portugal e zona do euro' },
  BRL: { symbol: 'R$', name: 'Real brasileiro', where: 'Brasil' },
  USD: { symbol: '$', name: 'Dólar americano', where: 'Estados Unidos' },
  GBP: { symbol: '£', name: 'Libra esterlina', where: 'Reino Unido' },
  CHF: { symbol: 'CHF', name: 'Franco suíço', where: 'Suíça' },
  CAD: { symbol: 'C$', name: 'Dólar canadiano', where: 'Canadá' },
  AUD: { symbol: 'A$', name: 'Dólar australiano', where: 'Austrália' },
  JPY: { symbol: '¥', name: 'Iene', where: 'Japão' },
}

/** Partes para mostrar valores grandes: “€ 347” e “,00” em tamanho menor. */
export function moneyParts(cents: number, currency = 'EUR') {
  const s = money(cents, currency)
  const i = s.lastIndexOf(',')
  return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i)]
}
