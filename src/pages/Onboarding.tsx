import { useState } from 'react'
import { update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { CURRENCIES } from '../lib/money'
import type { Area } from '../lib/types'
import { Icon } from '../components/Icon'

const zones = (() => { try { return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone') } catch { return ['Europe/Lisbon', 'America/Sao_Paulo'] } })()

export function Onboarding() {
  const { profile, saveProfile } = useAuth()
  const [step, setStep] = useState(0)
  const [name, setName] = useState(profile?.display_name ?? '')
  const [tz, setTz] = useState(profile?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [cur, setCur] = useState(profile?.currency_main ?? 'EUR')
  const { rows: areas } = useRows<Area>('areas', { order: { column: 'position' } })

  const steps = ['Sobre você', 'Áreas da vida']
  return (
    <div style={{ minHeight: '100%', padding: '24px 16px', background: 'linear-gradient(180deg, var(--lime-soft), var(--bg-canvas) 50%)' }}>
      <div className="stack" style={{ maxWidth: 560, margin: '0 auto', gap: 20 }}>
        <div className="row between">
          {step > 0 ? <button className="btn ghost small" onClick={() => setStep(step - 1)}>← Voltar</button> : <span />}
          <span className="mono muted">{step + 1} de {steps.length}</span>
        </div>
        <div className="row" style={{ gap: 4 }}>{steps.map((_, i) => <div key={i} style={{ flex: 1, height: 3, borderRadius: 2, background: i <= step ? 'var(--ink)' : 'var(--border)' }} />)}</div>

        {step === 0 && (
          <>
            <h1 className="serif" style={{ fontSize: 40, lineHeight: '44px', margin: 0 }}>Prazer! Conta um pouco sobre você.</h1>
            <label className="field"><span>Nome</span><input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="given-name" /></label>
            <div className="grid2" style={{ gap: 12 }}>
              <label className="field"><span>Fuso horário</span>
                <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>{(zones.includes(tz) ? zones : [tz, ...zones]).map((z) => <option key={z}>{z}</option>)}</select>
              </label>
              <label className="field"><span>Moeda principal</span>
                <select className="input" value={cur} onChange={(e) => setCur(e.target.value)}>{CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
              </label>
            </div>
            <p className="caption muted" style={{ margin: 0 }}>Fuso e moeda seguem o país onde você vive. Se recebe em outra moeda, dá para somar depois em Finanças.</p>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} disabled={!name.trim()} onClick={async () => { await saveProfile({ display_name: name.trim(), timezone: tz, currency_main: cur }); setStep(1) }}>Continuar</button>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="serif" style={{ fontSize: 40, lineHeight: '44px', margin: 0 }}>O que você quer cuidar neste ciclo?</h1>
            <p className="muted" style={{ margin: 0 }}>Escolha as áreas em foco. As outras ficam em manutenção, sem culpa. Dá para mudar depois.</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
              {areas.map((a) => {
                const on = a.focus || a.is_fixed
                return (
                  <button key={a.id} aria-pressed={on} disabled={a.is_fixed} onClick={() => update<Area>('areas', a.id, { focus: !a.focus })}
                    style={{ textAlign: 'left', padding: 14, borderRadius: 18, minHeight: 76, background: on ? `var(--${a.color}-bg)` : 'var(--bg-surface)', color: on ? `var(--${a.color}-fg)` : 'var(--text-primary)', boxShadow: on ? 'none' : 'inset 0 0 0 1.5px var(--border)', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 8 }}>
                    <span className="row between"><Icon name={a.icon} /><span>{a.is_fixed ? <Icon name="lock" size={16} /> : on ? <Icon name="check" size={16} /> : null}</span></span>
                    <span className="medium">{a.name}{a.is_fixed && <span className="mono" style={{ display: 'block', marginTop: 2 }}>sempre ativa</span>}</span>
                  </button>
                )
              })}
            </div>
            <button className="btn primary" style={{ alignSelf: 'flex-end' }} onClick={() => saveProfile({ onboarded: true })}>Começar</button>
          </>
        )}
      </div>
    </div>
  )
}
