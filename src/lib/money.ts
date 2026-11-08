/** Formata centavos na moeda do perfil (ex.: € 12,50). */
export function money(cents: number, currency = 'EUR', locale = 'pt-PT') {
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
