import { Link } from 'react-router-dom'
import { formatDistanceToNow } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { useRitualDraft } from '../lib/ritual'
import { Icon } from './Icon'

/** Cartão "continuar de onde parou" do ritual de novo ciclo (some quando não há ritual pela metade). */
export function RitualResume() {
  const d = useRitualDraft()
  if (!d) return null
  return (
    <Link to="/ciclo/trimestre" className="card row ritual-resume" style={{ gap: 12 }}>
      <span className="owner-ico"><Icon name="sparkle" size={16} /></span>
      <span className="grow stack" style={{ gap: 0, minWidth: 0 }}>
        <span className="medium">Ritual de novo ciclo em andamento</span>
        <span className="caption muted">{d.part ? `Parte ${d.part} de 3 · ` : ''}parou em {d.name}{d.updated ? ` · ${formatDistanceToNow(new Date(d.updated), { addSuffix: true, locale: ptBR })}` : ''}</span>
      </span>
      <span className="btn primary small">Continuar</span>
    </Link>
  )
}
