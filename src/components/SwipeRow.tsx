import { useRef, useState, type ReactNode } from 'react'
import { Icon } from './Icon'

export interface SwipeAction { label: string; icon: string; tone: 'lime' | 'mustard'; run: () => unknown }

/** No celular: arrastar a linha para a esquerda mostra ações (ex.: Amanhã e Feito). No computador não muda nada. */
export function SwipeRow({ actions, children }: { actions: SwipeAction[]; children: ReactNode }) {
  const W = actions.length * 76
  const [x, setX] = useState(0)
  const [drag, setDrag] = useState(false)
  const start = useRef<{ x: number; y: number; base: number; locked: 'h' | 'v' | null } | null>(null)
  if (!actions.length) return <>{children}</>
  const end = () => { start.current = null; setDrag(false); setX((v) => (v < -W / 2 ? -W : 0)) }
  return (
    <div className="swipe">
      <div className="swipe-actions" style={{ width: W }} aria-hidden={x === 0}>
        {actions.map((a) => (
          <button key={a.label} className={'swipe-btn ' + a.tone} tabIndex={x === 0 ? -1 : 0} onClick={() => { setX(0); a.run() }}>
            <Icon name={a.icon} size={18} />{a.label}
          </button>
        ))}
      </div>
      <div className="swipe-body" style={{ transform: `translateX(${x}px)`, transition: drag ? 'none' : 'transform .2s ease-out' }}
        onPointerDown={(e) => { if (e.pointerType !== 'touch') return; start.current = { x: e.clientX, y: e.clientY, base: x, locked: null } }}
        onPointerMove={(e) => {
          const s = start.current; if (!s) return
          const dx = e.clientX - s.x, dy = e.clientY - s.y
          if (!s.locked) { if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return; s.locked = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v' }
          if (s.locked === 'v') { start.current = null; return }
          setDrag(true); setX(Math.max(-W - 24, Math.min(0, s.base + dx)))
        }}
        onPointerUp={end} onPointerCancel={end}
        onClickCapture={(e) => { if (x !== 0) { e.preventDefault(); e.stopPropagation(); setX(0) } }}>
        {children}
      </div>
    </div>
  )
}
