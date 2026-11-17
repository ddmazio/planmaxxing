import { addDays } from 'date-fns'
import { fmt, fromYmd } from '../lib/dates'
import { DURATIONS, DURATIONS_OWNER, newCycleDates } from '../lib/cycle'
import { useIsAdmin } from '../pages/Admin'

const TIPS: Record<number, string> = {
  4: 'Bom para fechar o ano: uma meta só, passos curtos e uma revisão no fim.',
  6: 'Seis semanas de execução e uma de revisão. O placar e o ritual se ajustam sozinhos.',
  8: 'Oito semanas de execução e uma de revisão. Bom para um objetivo mais curto.',
  12: 'O método original: 12 semanas de execução e 1 de revisão.',
}

/** Durações que esta conta pode escolher: 8 ou 12 para todos; a dona testa 4, 6, 8 ou 12. */
export function useDurations() {
  const owner = useIsAdmin()
  return { owner, options: owner ? DURATIONS_OWNER : DURATIONS }
}

/** Escolha da duração do ciclo, com a linha de semanas e as datas que mudam junto. */
export function DurationPicker({ weeks, start, onChange }: { weeks: number; start: string; onChange: (w: number) => void }) {
  const { owner, options } = useDurations()
  const list = options.includes(weeks) ? options : [...options, weeks].sort((a, b) => a - b)
  const { ends_on } = newCycleDates(start, weeks)
  const execEnd = addDays(fromYmd(ends_on), -7)
  return (
    <div className="dur card stack" style={{ gap: 12 }}>
      <div className="row between" style={{ alignItems: 'flex-start', gap: 8 }}>
        <div className="stack" style={{ gap: 0 }}>
          <span className="mono muted">Duração do ciclo</span>
          <span className="serif dur-value">{weeks} semanas</span>
        </div>
        {owner && <span className="dur-pill">em teste · só você</span>}
      </div>
      <div className="dur-options" role="radiogroup" aria-label="Duração do ciclo">
        {list.map((w) => (
          <button key={w} type="button" role="radio" aria-checked={w === weeks} className={'dur-opt mono' + (w === weeks ? ' on' : '')} onClick={() => onChange(w)}>{w}</button>
        ))}
      </div>
      <div className="dur-line" aria-hidden="true" style={{ gridTemplateColumns: `repeat(${weeks}, 1fr) 18px` }}>
        {Array.from({ length: weeks }, (_, i) => <span key={i} className={i === 0 ? 'first' : ''} />)}
        <span className="review" />
      </div>
      <div className="row between mono" style={{ fontSize: 12, gap: 8, flexWrap: 'wrap' }}>
        <span>{fmt(fromYmd(start), 'd MMM')} → {fmt(execEnd, 'd MMM')}</span>
        <span className="muted">revisão até {fmt(fromYmd(ends_on), 'd MMM')}</span>
      </div>
      <span className="caption muted">{TIPS[weeks] ?? `${weeks} semanas de execução e 1 de revisão.`}</span>
    </div>
  )
}
