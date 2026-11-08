import { useRows } from '../lib/hooks'
import { useAuth } from '../lib/auth'
import { money } from '../lib/money'
import type { Expense } from '../lib/types'
import { PageHeader } from '../components/Shell'

export function Financas() {
  const { profile } = useAuth()
  const { rows } = useRows<Expense>('expenses', { order: { column: 'spent_on', ascending: false } })
  return (
    <div className="page">
      <PageHeader eyebrow="Etapa 2" title="Finanças" />
      <div className="card soft caption">O resumo com o orçamento 50/30/20, a sequência “no azul” e as moedas chega na etapa 2. Os gastos que você lançar pelo + já ficam guardados aqui.</div>
      <div className="card flush list">
        {rows.length ? rows.map((e) => (
          <div key={e.id} className="list-row"><span className="grow">{e.item}</span><span className="caption muted">{e.spent_on}</span><span className="medium">− {money(e.amount_cents, profile?.currency_main)}</span></div>
        )) : <div className="list-row muted caption">Nenhum gasto ainda. Experimente “almoço 12,50” no +.</div>}
      </div>
    </div>
  )
}
