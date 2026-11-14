import { useState } from 'react'
import { Icon } from './Icon'

/** Lista de frases editáveis: cada linha se edita no lugar, Enter adiciona mais uma. */
export function ListInput({ items, onChange, placeholder = 'Escreva mais uma…', max = 30, label }: {
  items: string[]; onChange: (v: string[]) => void; placeholder?: string; max?: number; label: string
}) {
  const [draft, setDraft] = useState('')
  const add = () => { const t = draft.trim(); if (!t || items.length >= max) return; onChange([...items, t]); setDraft('') }
  return (
    <div className="card flush list list-input" aria-label={label}>
      {items.map((it, i) => (
        <div key={i} className="list-row">
          <span className="li-dot" aria-hidden />
          <input className="input bare grow" defaultValue={it} maxLength={300} aria-label={`${label} ${i + 1}`}
            onBlur={(e) => { const v = e.target.value.trim(); const n = [...items]; if (v) n[i] = v; else n.splice(i, 1); if (v !== it) onChange(n) }} />
          <button className="faint" aria-label="Tirar" onClick={() => onChange(items.filter((_, j) => j !== i))}><Icon name="x" size={14} /></button>
        </div>
      ))}
      {items.length < max && (
        <form className="list-row" onSubmit={(e) => { e.preventDefault(); add() }}>
          <Icon name="plus" size={16} className="faint" />
          <input className="input bare grow" placeholder={placeholder} value={draft} maxLength={300} onChange={(e) => setDraft(e.target.value)} onBlur={add} aria-label={`Nova linha: ${label}`} />
        </form>
      )}
    </div>
  )
}

/** Uma etapa do lado esquerdo (rail), como nos rituais do Figma. */
export function RailSteps({ title, items, active, onPick, done }: { title: string; items: string[]; active: number; onPick?: (i: number) => void; done?: boolean }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className={'rail-head' + (active >= 0 ? ' on' : '')}><span className="mono">{title}</span>
        <span className="caption muted">{done ? 'feita ✓' : active >= 0 ? `${active + 1} de ${items.length}` : `${items.length} etapas`}</span></div>
      {active >= 0 && items.map((l, i) => (
        <button key={l} className={'rail-item' + (i === active ? ' on' : i < active ? ' done' : '')} onClick={() => onPick?.(i)} disabled={!onPick}>{l}</button>
      ))}
    </div>
  )
}
