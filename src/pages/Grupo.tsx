import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useOutletContext } from 'react-router-dom'
import { differenceInCalendarDays } from 'date-fns'
import { insert, removeWhere, rpc, touch, update, updateWhere, DEMO } from '../lib/db'
import { useAuth } from '../lib/auth'
import { useRows } from '../lib/hooks'
import { weekStart } from '../lib/dates'
import { execWeeks, score, weekOf } from '../lib/cycle'
import type { Area, Checkin, Cheer, Group, GroupInvite, GroupMember, List, ListMember, Task } from '../lib/types'
import { AreaIcon, Empty, SectionHead, Sheet } from '../components/ui'
import { Icon } from '../components/Icon'
import { PageHeader, type ShellCtx } from '../components/Shell'
import { useCycle } from './Ciclo'

/** Semana do grupo, contada desde a semana em que ele foi criado. */
export const groupWeek = (g: Group, d = new Date()) =>
  Math.max(1, Math.floor(differenceInCalendarDays(d, weekStart(new Date(g.created_at ?? d))) / 7) + 1)

const SHARE: [GroupMember['share'], string, string][] = [
  ['nothing', 'Nada', 'Você participa do check-in só falando.'],
  ['score', 'Placar e intenção', 'Recomendado. O número da semana e uma frase.'],
  ['goals', 'Placar + metas', 'Inclui o título das metas e o “TER”.'],
  ['all', 'Tudo', 'Também passos e hábitos.'],
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
            <span className="mono muted">Novo grupo</span>
            <span className="h3">Quem vai caminhar com você neste ciclo?</span>
            <p className="caption muted" style={{ margin: 0 }}>Grupos de 2 a 4 pessoas funcionam melhor, com um check-in curto por semana. Por padrão, o grupo vê só o seu placar e a sua intenção da semana. Metas e passos ficam privados, a menos que você mude. Finanças nunca entram.</p>
            <input className="input" placeholder="Nome do grupo" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label="Nome do grupo" />
            <button className="btn primary" disabled={!name.trim()}>Criar grupo</button>
          </form>
          <form className="card stack" onSubmit={join}>
            <span className="h3">Recebi um convite</span>
            <p className="caption muted" style={{ margin: 0 }}>Abra o link que mandaram para você, ou cole aqui.</p>
            <input className="input" placeholder="https://twelvefold-app.vercel.app/convite/…" value={link} onChange={(e) => setLink(e.target.value)} aria-label="Link do convite" />
            <button className="btn secondary" disabled={!link.trim()}>Entrar no grupo</button>
          </form>
        </div>
      )}
    </div>
  )
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']
type Score = { user_id: string; score: number | null; intention: string | null; worked: string | null }
type Plan = { user_id: string; goal_id: string; title: string; done_definition: string | null; area_name: string | null; area_color: string | null; steps_done: number; steps_total: number; week_steps: string[]; habits: string[] }

function GroupView({ group }: { group: Group }) {
  const { session } = useAuth()
  const me = session?.user.id ?? ''
  const { toast } = useOutletContext<ShellCtx>()
  const week = groupWeek(group)
  const { rows: members } = useRows<GroupMember>('group_members', { eq: { group_id: group.id }, order: { column: 'joined_at' } })
  const { rows: mine } = useRows<Checkin>('checkins', { eq: { group_id: group.id, week } })
  const { rows: cheers } = useRows<Cheer>('cheers', { eq: { group_id: group.id, week } })
  const { rows: invites } = useRows<GroupInvite>('group_invites', { eq: { group_id: group.id }, order: { column: 'created_at', ascending: false } })
  const { rows: tasks } = useRows<Task>('tasks', { eq: { completed_at: null } })
  const { rows: lists } = useRows<List>('lists')
  const { rows: listMembers } = useRows<ListMember>('list_members')
  const { rows: areas } = useRows<Area>('areas', { eq: { archived: false }, order: { column: 'position' } })
  const { people } = usePeople()
  const [scores, setScores] = useState<Score[]>([])
  const [plans, setPlans] = useState<Plan[]>([])
  const [invite, setInvite] = useState('')
  const [privacy, setPrivacy] = useState(false)
  const myMember = members.find((m) => m.user_id === me)
  const admin = myMember?.role === 'admin'
  const nameOf = (id: string) => (id === me ? 'Você' : people.find((p) => p.id === id)?.display_name?.split(' ')[0] || 'Alguém')

  const load = useCallback(() => {
    rpc<Score[]>('group_scores', { p_group: group.id, p_week: week }).then(setScores).catch(() => setScores([]))
    rpc<Plan[]>('group_plans', { p_group: group.id }).then(setPlans).catch(() => setPlans([]))
  }, [group.id, week])
  useEffect(load, [load, mine, members])

  // placar automático: passos feitos na semana atual do seu ciclo
  const { cycle, steps, goals } = useCycle()
  const cw = cycle ? weekOf(cycle) : 0
  const auto = cycle && cw >= 1 && cw <= execWeeks(cycle) ? score(steps.filter((s) => s.week === cw)) : null
  const myCheck = mine[0]
  const [intent, setIntent] = useState<string | null>(null)
  const [worked, setWorked] = useState<string | null>(null)
  const [manual, setManual] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const myScore = manual ?? myCheck?.score ?? auto ?? 50
  const intentVal = intent ?? myCheck?.intention ?? ''
  const workedVal = worked ?? myCheck?.worked ?? ''

  async function checkin() {
    const payload = { score: myScore, intention: intentVal.trim() || null, worked: workedVal.trim() || null }
    try {
      if (myCheck) await update<Checkin>('checkins', myCheck.id, payload)
      else await insert<Checkin>('checkins', { group_id: group.id, week, ...payload })
      setEditing(false); toast('Check-in feito')
    } catch (e) { toast(errMsg(e)) }
  }

  async function makeInvite() {
    try {
      const tok = await rpc<string>('create_invite', { p_group: group.id })
      setInvite(`${location.origin}/convite/${tok}`); touch('group_invites')
    } catch (e) { toast(errMsg(e)) }
  }
  async function shareInvite() {
    const text = `Entra no meu grupo "${group.name}" no Twelvefold:`
    try {
      if (navigator.share) await navigator.share({ title: 'Twelvefold', text, url: invite })
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
  async function cheer(to: string) {
    const mineCheer = cheers.find((c) => c.from_id === me && c.to_id === to)
    try { if (mineCheer) await removeWhere('cheers', { id: mineCheer.id }); else { await insert<Cheer>('cheers', { group_id: group.id, week, to_id: to, emoji: '👏' }); toast(`Incentivo enviado para ${nameOf(to)}`) } }
    catch (e) { toast(errMsg(e)) }
  }

  // tarefas em listas partilhadas (as “juntas”)
  const sharedList = (l: List) => l.owner_id !== me || listMembers.some((m) => m.list_id === l.id)
  const together = tasks.filter((t) => t.list_id && lists.some((l) => l.id === t.list_id && sharedList(l)))
  const done = scores.length
  const order = [...members].sort((a, b) => Number(b.user_id === me) - Number(a.user_id === me))
  const otherFirst = members.find((m) => m.user_id !== me)

  return (
    <>
      <div className="row between" style={{ flexWrap: 'wrap', gap: 8, marginTop: -8 }}>
        <span className="mono muted" style={{ textTransform: 'uppercase' }}>Grupo · {members.length} pessoa{members.length === 1 ? '' : 's'} · check-in · {WEEKDAYS[group.checkin_weekday]}</span>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn secondary small" onClick={() => setPrivacy(true)}><Icon name="lock" size={14} />Privacidade</button>
        </div>
      </div>

      <div className="grid2">
        <div className="stack">
          <div className="card lime stack" style={{ gap: 12 }}>
            <div className="row between"><span className="h3">Check-in da semana {week}</span><span className="caption">{done} de {members.length} já fizeram</span></div>
            {myCheck && !editing ? (
              <div className="row between"><span className="caption">Seu check-in está feito{myCheck.score != null ? ` · ${myCheck.score}%` : ''}.</span><button className="btn secondary small" style={{ background: 'var(--bg-surface)' }} onClick={() => setEditing(true)}>Editar</button></div>
            ) : (
              <>
                <div className="row" style={{ alignItems: 'baseline', gap: 8 }}><span className="big" style={{ fontSize: 44 }}>{myScore}%</span><span className="caption">da semana cumprida</span></div>
                <input type="range" min={0} max={100} step={5} value={myScore} onChange={(e) => setManual(Number(e.target.value))} aria-label="Sua % da semana" />
                <span className="caption">{auto != null ? `Pelo seu ciclo: ${auto}% dos passos desta semana. Pode ajustar.` : 'Sem passos no ciclo esta semana. Dê a sua nota.'}</span>
                <input className="input" placeholder="Intenção para a semana" value={intentVal} maxLength={500} onChange={(e) => setIntent(e.target.value)} aria-label="Intenção da semana" />
                <input className="input" placeholder="O que funcionou (para o grupo copiar)" value={workedVal} maxLength={500} onChange={(e) => setWorked(e.target.value)} aria-label="O que funcionou" />
                <div className="row" style={{ gap: 8 }}>
                  <button className="btn primary grow" onClick={checkin}>{myCheck ? 'Atualizar check-in' : 'Fazer check-in'}</button>
                  <Link className="btn secondary" style={{ background: 'var(--bg-surface)' }} to="/ciclo/ritual">Ritual completo</Link>
                </div>
              </>
            )}
          </div>

          <span className="mono muted" style={{ textTransform: 'uppercase' }}>Semana {week} · placar e intenção</span>
          {order.map((m) => {
            const sc = scores.find((x) => x.user_id === m.user_id)
            const gp = plans.filter((x) => x.user_id === m.user_id)
            const got = cheers.filter((c) => c.to_id === m.user_id)
            const iCheered = got.some((c) => c.from_id === me)
            return (
              <div key={m.user_id} className="card stack member-card">
                <div className="row" style={{ gap: 10 }}>
                  <span className="avatar">{nameOf(m.user_id).charAt(0).toUpperCase()}</span>
                  <div className="grow stack" style={{ gap: 0 }}>
                    <span className="medium">{m.user_id === me ? `${people.find((p) => p.id === me)?.display_name?.split(' ')[0] ?? 'Você'} (você)` : nameOf(m.user_id)}{m.role === 'admin' && <span className="caption muted"> · admin</span>}</span>
                    {!sc && <span className="caption muted">ainda não fez o check-in</span>}
                  </div>
                  <span className="big" style={{ fontSize: 28 }}>{!sc ? '' : sc.score == null ? <Icon name="lock" size={16} /> : `${sc.score}%`}</span>
                </div>
                {sc?.intention && <p className="serif member-quote">“{sc.intention}”</p>}
                {sc?.worked && <span className="caption"><span className="muted">Funcionou: </span>{sc.worked}</span>}
                {gp.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    {gp.map((g) => (
                      <div key={g.goal_id} className="stack" style={{ gap: 2 }}>
                        <div className="row between caption"><span className="medium">{g.title}</span><span className="muted">{g.steps_total ? `${Math.round((g.steps_done / g.steps_total) * 100)}%` : ''}</span></div>
                        {g.done_definition && <span className="caption muted">{g.done_definition}</span>}
                        {g.steps_total > 0 && <div className="bar"><span style={{ width: `${(g.steps_done / g.steps_total) * 100}%`, background: g.area_color ? `var(--${g.area_color}-bg)` : undefined }} /></div>}
                        {g.week_steps.length > 0 && <span className="caption muted">Esta semana: {g.week_steps.join(' · ')}</span>}
                        {g.habits.length > 0 && <span className="caption muted">Hábitos: {g.habits.join(' · ')}</span>}
                      </div>
                    ))}
                  </div>
                )}
                <div className="row between">
                  <span className="caption muted">{got.length ? `${got.length} incentivo${got.length === 1 ? '' : 's'} 👏` : ''}</span>
                  {m.user_id !== me && <button className={'btn small ' + (iCheered ? 'primary' : 'secondary')} onClick={() => cheer(m.user_id)}>{iCheered ? '👏 Enviado' : '👏 Mande um incentivo'}</button>}
                  {admin && m.user_id !== me && <button className="faint" aria-label={`Tirar ${nameOf(m.user_id)} do grupo`} onClick={() => confirm(`Tirar ${nameOf(m.user_id)} do grupo?`) && removeWhere('group_members', { group_id: group.id, user_id: m.user_id })}><Icon name="x" size={14} /></button>}
                </div>
              </div>
            )
          })}
        </div>

        <div className="stack">
          <SectionHead title="Juntas" action={<span className="caption muted">{together.length} aberta{together.length === 1 ? '' : 's'}</span>} />
          {together.length ? (
            <div className="card flush list">
              {together.slice(0, 8).map((t) => (
                <Link key={t.id} to={`/tarefa/${t.id}`} className="list-row">
                  <div className="grow stack" style={{ gap: 0 }}><span>{t.title}</span><span className="caption muted">{lists.find((l) => l.id === t.list_id)?.name}</span></div>
                  <Icon name="chevron" size={16} className="faint" />
                </Link>
              ))}
            </div>
          ) : <div className="card caption muted">Tarefas de listas partilhadas aparecem aqui, com quem faz o quê e uma conversa. Em <Link className="link" to="/tarefas">Tarefas</Link>, abra uma lista e toque no ícone de pessoas.</div>}

          <SectionHead title="O que você mostra" action={<button className="caption muted" onClick={() => setPrivacy(true)}>mudar</button>} />
          <button className="card stack" style={{ textAlign: 'left', gap: 4 }} onClick={() => setPrivacy(true)}>
            <span className="medium">{SHARE.find(([v]) => v === myMember?.share)?.[1] ?? 'Placar e intenção'}</span>
            <span className="caption muted">{SHARE.find(([v]) => v === myMember?.share)?.[2]}{myMember?.hidden_area_ids?.length ? ` · ${myMember.hidden_area_ids.length} área(s) nunca aparece(m)` : ''}</span>
          </button>

          {admin && (
            <>
              <SectionHead title="Convidadas" action={<span className="caption muted">{members.length} de 8 · 2 a 4 funcionam melhor</span>} />
              <div className="card stack" style={{ gap: 10 }}>
                {invites.length > 0 && (
                  <div className="stack" style={{ gap: 6 }}>
                    {invites.slice(0, 6).map((i) => (
                      <div key={i.id} className="row between caption">
                        <span>{i.used_by ? nameOf(i.used_by) : `Convite de ${new Date(i.created_at).toLocaleDateString('pt-PT', { day: 'numeric', month: 'short' })}`}</span>
                        <span className="muted">{i.used_at ? 'entrou' : new Date(i.expires_at) < new Date() ? 'expirou' : 'convite enviado'}</span>
                      </div>
                    ))}
                  </div>
                )}
                {invite ? (
                  <>
                    <input className="input" readOnly value={invite} onFocus={(e) => e.target.select()} aria-label="Link de convite" />
                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn primary grow" onClick={shareInvite}><Icon name="users" size={16} />Enviar link</button>
                      <button className="btn secondary" onClick={() => setInvite('')}>Novo</button>
                    </div>
                    <span className="caption muted">Vale para 1 pessoa, por 7 dias. Mande só para quem você quer no grupo.</span>
                  </>
                ) : <button className="btn secondary" disabled={members.length >= 8} onClick={makeInvite}><Icon name="plus" size={16} />Convidar mais 1</button>}
                <label className="row between caption"><span>Dia do check-in</span>
                  <select className="input" style={{ width: 'auto' }} value={group.checkin_weekday} onChange={(e) => update<Group>('groups', group.id, { checkin_weekday: Number(e.target.value) })}>
                    {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
              </div>
            </>
          )}

          <button className="btn ghost small" style={{ alignSelf: 'flex-start', color: 'var(--danger)' }} onClick={leave}>Sair do grupo</button>
        </div>
      </div>

      {privacy && myMember && (
        <PrivacySheet group={group} member={myMember} areas={areas} onClose={() => setPrivacy(false)} viewer={otherFirst ? nameOf(otherFirst.user_id) : null}
          preview={{ name: people.find((p) => p.id === me)?.display_name?.split(' ')[0] ?? 'Você', score: myCheck?.score ?? auto, intention: myCheck?.intention ?? null, worked: myCheck?.worked ?? null,
            goals: goals.map((g) => ({ id: g.id, title: g.title, def: g.done_definition, area: g.area_id, steps: steps.filter((s) => s.goal_id === g.id), week: steps.filter((s) => s.goal_id === g.id && s.week === cw).map((s) => s.title) })) }} />
      )}
    </>
  )
}

/** Privacidade, como no Figma: 4 níveis, exceções por área e “como a Lu te vê”. */
function PrivacySheet({ group, member, areas, onClose, viewer, preview }: {
  group: Group; member: GroupMember; areas: Area[]; onClose: () => void; viewer: string | null
  preview: { name: string; score: number | null; intention: string | null; worked: string | null; goals: { id: string; title: string; def: string | null; area: string | null; steps: { done_at: string | null }[]; week: string[] }[] }
}) {
  const { toast } = useOutletContext<ShellCtx>()
  const [share, setShare] = useState(member.share)
  const [hidden, setHidden] = useState<string[]>(member.hidden_area_ids ?? [])
  const [shown, setShown] = useState<string[]>(member.shown_goal_area_ids ?? [])
  const rule = (id: string) => (hidden.includes(id) ? 'hide' : shown.includes(id) ? 'goals' : 'default')
  const setRule = (id: string, v: string) => { setHidden(v === 'hide' ? [...hidden.filter((x) => x !== id), id] : hidden.filter((x) => x !== id)); setShown(v === 'goals' ? [...shown.filter((x) => x !== id), id] : shown.filter((x) => x !== id)) }
  const fixed = new Set(areas.filter((a) => a.is_fixed).map((a) => a.id))
  const visibleGoals = preview.goals.filter((g) => !(g.area && fixed.has(g.area)) && !(g.area && hidden.includes(g.area)) && (share === 'goals' || share === 'all' || (g.area && shown.includes(g.area))))
  async function save() {
    try { await updateWhere('group_members', { group_id: group.id, user_id: member.user_id }, { share, hidden_area_ids: hidden, shown_goal_area_ids: shown }); toast('Privacidade guardada'); onClose() }
    catch (e) { toast(errMsg(e)) }
  }
  return (
    <Sheet open onClose={onClose} title="Privacidade" labelledBy="privacy-sheet">
      <h2 className="serif-title" style={{ fontSize: 28, lineHeight: '32px' }}>O que “{group.name}” pode ver?</h2>
      <div className="stack" style={{ gap: 8 }}>
        {SHARE.map(([v, l, h]) => <button key={v} className={'choice' + (share === v ? ' on' : '')} onClick={() => setShare(v)}><span className="medium">{l}</span><span className="caption muted">{h}</span></button>)}
      </div>
      <span className="mono muted">Exceções por área</span>
      <div className="card flush list">
        {areas.filter((a) => !a.is_fixed).map((a) => (
          <div key={a.id} className="list-row"><AreaIcon area={a} size={26} /><span className="grow">{a.name}</span>
            <select className="input" style={{ width: 'auto' }} value={rule(a.id)} onChange={(e) => setRule(a.id, e.target.value)} aria-label={`Regra para ${a.name}`}>
              <option value="default">como o nível</option><option value="hide">nunca mostrar</option><option value="goals">mostrar metas</option>
            </select></div>
        ))}
        <div className="list-row caption muted"><Icon name="lock" size={14} />Finanças nunca aparecem para o grupo, em nenhum nível.</div>
      </div>
      <span className="mono muted">Como {viewer ?? 'o grupo'} te vê</span>
      <div className="card stack member-card" style={{ background: 'var(--bg-canvas)' }}>
        <div className="row" style={{ gap: 10 }}><span className="avatar">{preview.name.charAt(0)}</span><span className="grow medium">{preview.name}</span>
          <span className="big" style={{ fontSize: 26 }}>{share === 'nothing' ? <Icon name="lock" size={16} /> : preview.score != null ? `${preview.score}%` : '–'}</span></div>
        {share !== 'nothing' && preview.intention && <p className="serif member-quote">“{preview.intention}”</p>}
        {share !== 'nothing' && preview.worked && <span className="caption"><span className="muted">Funcionou: </span>{preview.worked}</span>}
        {visibleGoals.map((g) => (
          <div key={g.id} className="stack" style={{ gap: 2 }}>
            <span className="caption medium">{g.title}</span>{g.def && <span className="caption muted">{g.def}</span>}
            {share === 'all' && g.week.length > 0 && <span className="caption muted">Esta semana: {g.week.join(' · ')}</span>}
          </div>
        ))}
        {share === 'nothing' && !visibleGoals.length && <span className="caption muted">Você participa do check-in só falando.</span>}
      </div>
      <button className="btn primary" onClick={save}>Guardar</button>
    </Sheet>
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
