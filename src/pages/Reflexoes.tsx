import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useRows } from '../lib/hooks'
import { addDays, fmt, fromYmd } from '../lib/dates'
import { EXEC_WEEKS, currentCycle, score } from '../lib/cycle'
import type { Cycle, Goal, Reflection, Step } from '../lib/types'
import { Empty, SectionHead } from '../components/ui'
import { PageHeader } from '../components/Shell'

type Filter = 'tudo' | 'ciclos' | 'checkins'

interface Card { key: string; kind: 'CHECK-IN' | 'CICLO'; when: string; sort: string; score: number | null; title: string; body: string | null; to?: string }

const firstSentence = (s: string) => s.split(/(?<=[.!?])\s/)[0].slice(0, 90)

export function Reflexoes() {
  const [filter, setFilter] = useState<Filter>('tudo')
  const { rows: cycles } = useRows<Cycle>('cycles', { order: { column: 'starts_on', ascending: false } })
  const { rows: refl, loading } = useRows<Reflection>('reflections')
  const { rows: goals } = useRows<Goal>('goals')
  const { rows: steps } = useRows<Step>('steps')
  const cur = currentCycle(cycles)

  const weekStartOf = (c: Cycle, w: number) => addDays(fromYmd(c.starts_on), (w - 1) * 7)

  const checkins: Card[] = refl.filter((r) => r.kind === 'review' && r.week != null).flatMap((r) => {
    const c = cycles.find((x) => x.id === r.cycle_id)
    if (!c) return []
    const [worked, stuck, main] = r.answers.map((a) => a?.trim() ?? '')
    const date = weekStartOf(c, r.week!)
    const body = [worked && `Funcionou: ${worked}`, stuck && `Travou: ${stuck}`].filter(Boolean).join(' ')
    return [{
      key: r.id, kind: 'CHECK-IN' as const, when: `semana ${r.week} · ${fmt(date, 'd MMM')}`, sort: date.toISOString(), score: r.score,
      title: r.title || firstSentence(main || worked || 'Ritual da semana'), body: body || null,
      to: c.id === cur?.id ? `/ciclo/ritual?semana=${r.week}` : undefined,
    }]
  })

  const cycleCards: Card[] = cycles.filter((c) => c.id !== cur?.id || c.status === 'closed').map((c) => {
    const gs = goals.filter((g) => g.cycle_id === c.id)
    const st = steps.filter((s) => gs.some((g) => g.id === s.goal_id))
    const weekly = Array.from({ length: EXEC_WEEKS }, (_, i) => score(st.filter((s) => s.week === i + 1))).filter((v): v is number => v != null)
    const avg = weekly.length ? Math.round(weekly.reduce((a, b) => a + b, 0) / weekly.length) : null
    const met = gs.filter((g) => { const x = st.filter((s) => s.goal_id === g.id); return x.length > 0 && x.every((s) => s.done_at) }).length
    const final = refl.find((r) => r.cycle_id === c.id && r.kind === 'review' && (r.week ?? 0) > EXEC_WEEKS)
    const body = [avg != null && `Placar médio ${avg}%`, gs.length && `${met} de ${gs.length} meta${gs.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
    return {
      key: c.id, kind: 'CICLO' as const, when: `${c.name} · ${fmt(fromYmd(c.starts_on), 'MMM')} a ${fmt(fromYmd(c.ends_on), 'MMM')}`, sort: c.ends_on, score: avg,
      title: c.words[0] ? `“${c.words[0]}”` : c.name, body: [body, final?.answers[0] && `O que repetir: ${final.answers[0]}`].filter(Boolean).join('. ') || null,
    }
  })

  const cards = [...(filter !== 'checkins' ? cycleCards : []), ...(filter !== 'ciclos' ? checkins : [])].sort((a, b) => (a.sort < b.sort ? 1 : -1))
  const withWords = cycles.filter((c) => c.words.length)

  return (
    <div className="page wide">
      <PageHeader eyebrow="Tudo o que você já escreveu" title="Reflexões" right={
        <div className="seg" role="tablist" style={{ minWidth: 300 }}>
          {([['tudo', 'Tudo'], ['ciclos', 'Ciclos'], ['checkins', 'Check-ins']] as [Filter, string][]).map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} style={{ whiteSpace: 'nowrap', padding: '0 14px' }} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>} />

      <div className="grid2" style={{ gridTemplateColumns: undefined }}>
        <div className="stack">
          {cards.length ? cards.map((c) => (
            <article key={c.key} className="card stack" style={{ gap: 8 }}>
              <div className="row between">
                <span className="row" style={{ gap: 8 }}><span className="pill mono">{c.kind}</span><span className="caption muted">{c.when}</span></span>
                {c.score != null && <span className={'big' + (c.score >= 85 ? ' ok' : '')} style={{ fontSize: 22 }}>{c.score}%</span>}
              </div>
              <span className="h3">{c.title}</span>
              {c.body && <p className="muted" style={{ margin: 0 }}>{c.body}</p>}
              {c.to && <Link className="caption medium" to={c.to} style={{ alignSelf: 'flex-start' }}>Abrir →</Link>}
            </article>
          )) : <Empty>{loading ? 'Carregando…' : <>Cada ritual da semana e cada ciclo encerrado ficam guardados aqui. <Link className="link" to="/ciclo/ritual">Fazer o ritual desta semana</Link></>}</Empty>}
        </div>

        <div className="stack">
          <SectionHead title={cur ? `Who is she? · ${cur.name}` : 'Who is she?'} />
          {cur?.who_is_she.length ? (
            <div className="card ink stack" style={{ gap: 6 }}>
              {cur.who_is_she.map((w) => <span key={w} className="serif" style={{ fontSize: 22, lineHeight: '28px' }}>{w}</span>)}
            </div>
          ) : <Empty>Escreva no Plano do ciclo quem você é no fim dele. <Link className="link" to="/ciclo">Abrir o plano</Link></Empty>}

          <SectionHead title="Palavras de cada ciclo" />
          {withWords.length ? (
            <div className="card flush list">
              {withWords.map((c) => (
                <div key={c.id} className="list-row">
                  <span className="mono muted" style={{ width: 72, flex: 'none' }}>{c.name}</span>
                  <div className="wordchips">{c.words.map((w) => <span key={w}>{w}</span>)}</div>
                </div>
              ))}
            </div>
          ) : <Empty>As 3 palavras de cada ciclo aparecem aqui.</Empty>}
        </div>
      </div>
    </div>
  )
}
