import { useEffect, type ReactNode } from 'react'
import type { Area } from '../lib/types'
import { Icon } from './Icon'

export function AreaTag({ area }: { area?: Area | null }) {
  if (!area) return null
  return (
    <span className="tag" style={{ background: `var(--${area.color}-bg)`, color: `var(--${area.color}-fg)` }}>
      <span className="dot" style={{ background: `var(--${area.color}-fg)`, width: 6, height: 6 }} />
      {area.name}
    </span>
  )
}

export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" role="switch" aria-checked={on} aria-label={label} className="toggle" onClick={() => onChange(!on)} />
}

export function Sheet({ open, onClose, title, children, labelledBy }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; labelledBy?: string }) {
  useEffect(() => {
    if (!open) return
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', k)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', k); document.body.style.overflow = '' }
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={labelledBy}>
        <div className="grabber" />
        {title !== undefined && (
          <div className="row between">
            <button className="btn ghost small" onClick={onClose}>Cancelar</button>
            <h2 className="h3" id={labelledBy}>{title}</h2>
            <span style={{ width: 80 }} />
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty caption">{children}</div> }

export function Check({ done, onToggle, label }: { done: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" className={'check' + (done ? ' on' : '')} aria-pressed={done} aria-label={label}
      onClick={(e) => { e.stopPropagation(); onToggle() }}>
      {done && <Icon name="check" size={13} />}
    </button>
  )
}

export function SectionHead({ title, action }: { title: string; action?: ReactNode }) {
  return <div className="section-head"><h2 className="h3">{title}</h2>{action}</div>
}

export function Toast({ msg }: { msg: string | null }) { return msg ? <div className="toast" role="status">{msg}</div> : null }
