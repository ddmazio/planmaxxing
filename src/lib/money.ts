/** Formata centavos na moeda do perfil (ex.: € 12,50). */
export function money(cents: number, currency = 'EUR', locale = 'pt-PT') {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100)
}
export const CURRENCIES: [string, string][] = [
  ['EUR', 'Euro (€)'], ['BRL', 'Real brasileiro (R$)'], ['USD', 'Dólar americano ($)'], ['GBP', 'Libra esterlina (£)'],
  ['CHF', 'Franco suíço'], ['CAD', 'Dólar canadiano'], ['AUD', 'Dólar australiano'], ['JPY', 'Iene'],
]
