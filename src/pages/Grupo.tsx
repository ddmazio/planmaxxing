import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { differenceInCalendarDays } from 'date-fns'
import { insert, removeWhere, rpc, touch, update, updateWhere, DEMO } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { weekStart } from '../lib/dates'
import { score, weekOf } from '../lib/cycle'
import type { Checkin, Group, GroupMember } from '../lib/types'
import { Empty, SectionHead } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader, type ShellCtx } from '../components/Shell'
import { useCycle } from './Ciclo'

/** Semana do grupo, contada desde a semana em que ele foi criado. */
export const groupWeek = (g: Group, d = new Date()) =>
  Math.max(1, Math.floor(differenceInCalendarDays(d, weekStart(new Date(g.created_at ?? d))) / 7) + 1)

const SHARE: [GroupMember['share'], string, string][] = [
  ['nothing', 'Nada', 'Só aparece que você está no grupo.'],
  ['score', 'Só placar', 'O grupo vê sua % da semana.'],
  ['all', 'Tudo', 'O grupo vê sua % e a sua intenção da semana.'],
]

const errMsg = (e: unknown) => {
  const m = e instanceof Error ? e.message : String(e)
  if (m.includes('group full')) return 'O grupo já tem 8 pessoas.'
  if (m.includes('invalid invite')) return 'Este convite não vale mais. Peça um novo.'
  if (m.includes('forbidden')) return 'Só quem administra o grupo pode convidar.'
  return m
}

type Person = { id: string; display_name: string }
export function usePeople() {
  const [people, setPeople] = useState<Person[]>([])
  const load = useCallback(() => { if (!DEMO) rpc<Person[]>('group_profiles').then(setPeople).catch(() => setPeople([])) }, [])
  useEffect(load, [load])
  return { people, reload: load }
}

export function Grupo() {
  const { toast } = useOutletContext<ShellCtx>()
  const { rows: groups, loading } = useRows<Group>('groups', { order: { column: 'created_at' } }, !DEMO)
  const [sel, setSel] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [link, setLink] = useState('')
  const nav = useNavigate()

  if (DEMO) return (
    <div className="page"><PageHeader title="Grupo" />
      <Empty>O grupo precisa da conta online, porque junta pessoas diferentes. No modo demonstração ele fica desligado.</Empty></div>
  )
  if (loading) return <div className="page"><p className="muted">Carregando…</p></div>
  const group = groups.find((g) => g.id === sel) ?? groups[0]

  async function create(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    try { const id = await rpc<string>('create_group', { p_name: name.trim() }); setName(''); setSel(id); touch('groups'); touch('group_members'); toast('Grupo criado. Agora convide alguém.') }
    catch (err) { toast(errMsg(err)) }
  }
  function join(e: React.FormEvent) {
    e.preventDefault()
    const tok = link.trim().match(/[0-9a-f]{48}/)?.[0]
    if (!tok) { toast('Cole o link inteiro do convite.'); return }
    nav(`/convite/${tok}`)
  }

  return (
    <div className="page wide">
      <PageHeader eyebrow="Grupo" title={group ? group.name : 'Crescer junto'} />
      {groups.length > 1 && (
        <div className="chips">{groups.map((g) => <button key={g.id} className={'chip' + (g.id === group?.id ? ' on' : '')} onClick={() => setSel(g.id)}>{g.name}</button>)}</div>
      )}

      {group ? <GroupView key={group.id} group={group} /> : (
        <div className="grid2">
          <form className="card stack" onSubmit={create}>
            <span className="h3">Criar um grupo</span>
            <p className="caption muted" style={{ margin: 0 }}>Até 8 pessoas próximas fazem o check-in da semana juntas. Cada pessoa escolhe o que mostra. Finanças nunca entram no grupo.</p>
            <input className="input" placeholder="Nome do grupo" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Nome do grupo" />
            <button className="btn primary" disabled={!name.trim()}>Criar grupo</button>
          </form>
          <form className="card stack" onSubmit={join}>
            <span className="h3">Recebi um convite</span>
            <p className="caption muted" style={{ margin: 0 }}>Abra o link que mandaram para você, ou cole aqui.</p>
            <input className="input" placeholder="https://planmaxxing.vercel.app/convite/…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link do convite" />
            <button className="btn secondary" disabled={!link.trim()}>Entrar no grupo</button>
          </form>
        </div>
      )}
    </div>
  )
}

function GroupView({ group }: { group: Group }) {
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const { toast } = useOutletContext<ShellCtx>()
  const week = groupWeek(group)
  const { rows: members } = useRows<GroupMember>('group_members', { eq: { group_id: group.id }, order: { column: 'joined_at' } })
  const { rows: mine } = useRows<Checkin>('checkins', { eq: { group_id: group.id, week } })
  const { people } = usePeople()
  const [scores, setScores] = useState<{ user_id: string; score: number | null; intention: string | null }[]>([])
  const [invite, setInvite] = useState('')
  const myMember = members.find((m) => m.user_id === me)
  const admin = myMember?.role === 'admin'
  const nameOf = (id: string) => (id === me ? 'Você' : people.find((p) => p.id === id)?.display_name || 'Alguém')

  const loadScores = useCallback(() => { rpc<typeof scores>('group_scores', { p_group: group.id, p_week: week }).then(setScores).catch(() => setScores([])) }, [group.id, week])
  useEffect(loadScores, [loadScores, mine])

  // placar automático: passos feitos na semana atual do seu ciclo
  const { cycle, steps } = useCycle()
  const cw = cycle ? weekOf(cycle) : 0
  const auto = cycle && cw >= 1 && cw <= 12 ? score(steps.filter((s) => s.week === cw)) : null
  const myCheck = mine[0]
  const [intent, setIntent] = useState<string | null>(null)
  const [manual, setManual] = useState<number | null>(null)
  const myScore = manual ?? myCheck?.score ?? auto ?? 50
  const intentVal = intent ?? myCheck?.intention ?? ''

  async function checkin() {
    const payload = { score: myScore, intention: intentVal.trim() || null }
    try {
      if (myCheck) await update<Checkin>('checkins', myCheck.id, payload)
      else await insert<Checkin>('checkins', { group_id: group.id, week, ...payload })
      toast('Check-in feito')
    } catch (e) { toast(errMsg(e)) }
  }

  async function makeInvite() {
    try {
      const tok = await rpc<string>('create_invite', { p_group: group.id })
      const url = `${location.origin}/convite/${tok}`
      setInvite(url)
    } catch (e) { toast(errMsg(e)) }
  }
  async function shareInvite() {
    const text = `Entra no meu grupo "${group.name}" no Dream Board:`
    try {
      if (navigator.share) await navigator.share({ title: 'Dream Board', text, url: invite })
      else { await navigator.clipboard.writeText(invite); toast('Link copiado') }
    } catch { /* cancelado */ }
  }

  async function leave() {
    const others = members.filter((m) => m.user_id !== me)
    const msg = admin && others.length && !others.some((m) => m.role === 'admin')
      ? 'Você é a única pessoa que administra. Quem ficar não vai poder convidar. Sair mesmo assim?'
      : 'Sair deste grupo? Você deixa de ver o placar e as listas partilhadas por aqui.'
    if (!confirm(msg)) return
    await removeWhere('group_members', { group_id: group.id, user_id: me })
    location.assign('/grupo')
  }

  return (
    <div className="grid2">
      <div className="stack">
        <div className="card lime stack" style={{ gap: 12 }}>
          <div className="row between"><span className="mono">Check-in · semana {week}</span>{myCheck && <span className="pill caption" style={{ background: 'var(--bg-surface)' }}><Icon name="check" size={12} /> feito</span>}</div>
          <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big" style={{ fontSize: 48 }}>{myScore}%</span><span className="caption">da semana cumprida</span></div>
          <input type="range" min={0} max={100} step={5} value={myScore} onChange={(e) => setManual(Number(e.target.value))} aria-label="Sua % da semana" />
          <span className="caption">{auto != null ? `Pelo seu ciclo: ${auto}% dos passos desta semana. Pode ajustar.` : 'Sem passos no ciclo esta semana. Dê a sua nota.'}</span>
          <input className="input" placeholder="Intenção para a semana (opcional)" value={intentVal} maxLength={500} onChange={(e) => setIntent(e.target.value)} aria-label="Intenção da semana" />
          <button className="btn primary" onClick={checkin}>{myCheck ? 'Atualizar check-in' : 'Fazer check-in'}</button>
        </div>

        <SectionHead title="Placar da semana" />
        <div className="card flush list">
          {members.map((m) => {
            const s = scores.find((x) => x.user_id === m.user_id)
            return (
              <div key={m.user_id} className="list-row">
                <span className="icon-btn" style={{ background: 'var(--bg-muted)', fontWeight: 500 }}>{nameOf(m.user_id).charAt(0).toUpperCase()}</span>
                <div className="grow stack" style={{ gap: 2 }}>
                  <span className="medium">{nameOf(m.user_id)}{m.role === 'admin' && <span className="caption muted"> · admin</span>}</span>
                  {s?.intention && <span className="caption muted">“{s.intention}”</span>}
                </div>
                <span className="medium">{!s ? <span className="caption muted">ainda não</span> : s.score == null ? <span className="caption muted"><Icon name="lock" size={12} /> privado</span> : `${s.score}%`}</span>
                {admin && m.user_id !== me && <button className="faint" aria-label={`Tirar ${nameOf(m.user_id)} do grupo`} onClick={() => confirm(`Tirar ${nameOf(m.user_id)} do grupo?`) && removeWhere('group_members', { group_id: group.id, user_id: m.user_id })}><Icon name="x" size={16} /></button>}
              </div>
            )
          })}
        </div>
      </div>

      <div className="stack">
        <SectionHead title="O que você mostra" />
        <div className="card stack" style={{ gap: 10 }}>
          <div className="seg">
            {SHARE.map(([v, l]) => <button key={v} className={myMember?.share === v ? 'on' : ''} onClick={() => updateWhere('group_members', { group_id: group.id, user_id: me }, { share: v })}>{l}</button>)}
          </div>
          <span className="caption muted">{SHARE.find(([v]) => v === myMember?.share)?.[2]} Seu e-mail, suas finanças e o resto do app nunca aparecem.</span>
        </div>

        {admin && (
          <>
            <SectionHead title="Convidar" action={<span className="caption muted">{members.length} de 8</span>} />
            <div className="card stack" style={{ gap: 10 }}>
              {invite ? (
                <>
                  <input className="input" readOnly value={invite} onFocus={(e) => e.target.select()} aria-label="Link do convite" />
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn primary grow" onClick={shareInvite}><Icon name="users" size={16} />Enviar link</button>
                    <button className="btn secondary" onClick={() => setInvite('')}>Novo</button>
                  </div>
                  <span className="caption muted">Vale para 1 pessoa, por 7 dias. Mande só para quem você quer no grupo.</span>
                </>
              ) : <button className="btn secondary" disabled={members.length >= 8} onClick={makeInvite}><Icon name="plus" size={16} />Criar link de convite</button>}
            </div>
          </>
        )}

        <SectionHead title="Listas partilhadas" />
        <div className="card caption muted">Em <Link className="link" to="/tarefas">Tarefas</Link>, abra uma lista sua e toque no ícone de pessoas para partilhar com alguém deste grupo.</div>

        <button className="btn ghost small" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={leave}>Sair do grupo</button>
      </div>
    </div>
  )
}

const accepting = new Map<string, Promise<string>>()

/** /convite/:token → entra no grupo e vai para /grupo. */
export function AceitarConvite({ token }: { token: string }) {
  const nav = useNavigate()
  const { toast } = useOutletContext<ShellCtx>()
  const [err, setErr] = useState('')
  useEffect(() => {
    let alive = true
    if (!accepting.has(token)) accepting.set(token, rpc<string>('accept_invite', { p_token: token }))
    accepting.get(token)!
      .then(() => { if (!alive) return; try { localStorage.removeItem('pending-invite') } catch { /* */ } touch('groups'); toast('Você entrou no grupo'); nav('/grupo', { replace: true }) })
      .catch((e) => { if (!alive) return; try { localStorage.removeItem('pending-invite') } catch { /* */ } setErr(errMsg(e)) })
    return () => { alive = false }
  }, [token, nav, toast])
  return <div className="page"><PageHeader title="Convite" />{err ? <Empty>{err} <Link className="link" to="/grupo">Ir para o Grupo</Link></Empty> : <p className="muted">Entrando no grupo…</p>}</div>
}
