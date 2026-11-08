import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { DEMO, insert, insertPlain, remove, removeWhere, update } from '../lib/db'
import { useAuth } from '../lib/auth'
import { usePeople } from './Grupo'
import { useRows } from '../lib/hooks'
import { todayYmd } from '../lib/dates'
import { SMART, type SmartKey } from '../lib/tasks'
import type { Area, List, ListMember, Task } from '../lib/types'
import { TaskRow } from '../components/TaskRow'
import { Empty, Sheet, Toggle } from '../components/ui'
import { Icon } from '../components/Icon'
import { TaskDetail } from './TaskDetail'

function useIsDesktop() { return typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches }

export function Tarefas() {
  const { key } = useParams()
  const desktop = useIsDesktop()
  const { rows: tasks } = useRows<Task>('tasks')
  const { rows: lists } = useRows<List>('lists', { order: { column: 'position' } })
  const { rows: areas } = useRows<Area>('areas')
  const active = key ?? (desktop ? 'planejado' : null)

  return (
    <div className="page wide">
      <div style={{ display: 'grid', gridTemplateColumns: desktop ? '280px 1fr' : '1fr', gap: 16, alignItems: 'start' }}>
        {(desktop || !active) && <Lists tasks={tasks} lists={lists} active={active} />}
        {active && <ListView k={active} tasks={tasks} lists={lists} areas={areas} desktop={desktop} />}
      </div>
    </div>
  )
}

function Lists({ tasks, lists, active }: { tasks: Task[]; lists: List[]; active: string | null }) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const nav = useNavigate()
  const { session } = useAuth()
  const { rows: members } = useRows<ListMember>('list_members', undefined, !DEMO)
  const shared = (l: List) => (session && l.owner_id && l.owner_id !== session.user.id) || members.some((m) => m.list_id === l.id)
  const open = tasks.filter((t) => !t.completed_at)
  const count = (k: string) => (k in SMART ? open.filter(SMART[k as SmartKey].filter).length : open.filter((t) => t.list_id === k).length)
  const Row = ({ to, icon, color, label }: { to: string; icon: string; color: string; label: string }) => (
    <Link to={`/tarefas/${to}`} className="list-row" style={{ padding: '11px 12px', borderRadius: 12, background: active === to ? 'var(--bg-muted)' : undefined }}>
      <span style={{ color: `var(--${color}-fg)` }}><Icon name={icon} /></span><span className="grow">{label}</span><span className="mono muted">{count(to) || ''}</span>
    </Link>
  )
  return (
    <div className="stack">
      <h1 className="h1">Tarefas</h1>
      <div className="banner row"><Icon name="sun" size={16} /><span>As tarefas de hoje aparecem no Hoje, junto com a agenda.</span></div>
      <nav className="card" style={{ padding: 6 }} aria-label="Listas inteligentes">
        {(Object.keys(SMART) as SmartKey[]).map((k) => <Row key={k} to={k} icon={SMART[k].icon} color={SMART[k].color} label={SMART[k].name} />)}
      </nav>
      <span className="mono muted">Minhas listas</span>
      <nav className="card" style={{ padding: 6 }} aria-label="Minhas listas">
        {lists.map((l) => <Row key={l.id} to={l.id} icon={shared(l) ? 'users' : 'list'} color="neutro" label={l.name} />)}
        {creating ? (
          <form className="row" style={{ padding: '6px 12px' }} onSubmit={async (e) => { e.preventDefault(); if (!name.trim()) return; const l = await insert<List>('lists', { name: name.trim(), icon: 'list', position: lists.length + 1 }); setName(''); setCreating(false); nav(`/tarefas/${l.id}`) }}>
            <input className="input" autoFocus maxLength={60} value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da lista" aria-label="Nome da nova lista" />
            <button className="btn primary small">Criar</button>
          </form>
        ) : (
          <button className="list-row" style={{ padding: '11px 12px' }} onClick={() => setCreating(true)}><Icon name="plus" /><span>Nova lista</span></button>
        )}
      </nav>
    </div>
  )
}

function ListView({ k, tasks, lists, areas, desktop }: { k: string; tasks: Task[]; lists: List[]; areas: Area[]; desktop: boolean }) {
  const nav = useNavigate()
  const [title, setTitle] = useState('')
  const [showDone, setShowDone] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [sharing, setSharing] = useState(false)
  const { session } = useAuth()
  const me = session?.user.id
  const { people } = usePeople()
  const { rows: members } = useRows<ListMember>('list_members', { eq: { list_id: k } }, !DEMO && !(k in SMART))
  const smart = k in SMART ? SMART[k as SmartKey] : null
  const list = lists.find((l) => l.id === k)
  if (!smart && !list) return <Empty>Lista não encontrada.</Empty>
  const inList = tasks.filter((t) => (smart ? smart.filter(t) : t.list_id === k))
  const open = inList.filter((t) => !t.completed_at).sort((a, b) => (a.due_on ?? '9') < (b.due_on ?? '9') ? -1 : 1)
  const done = inList.filter((t) => t.completed_at)
  const add = async () => {
    if (!title.trim()) return
    const base: Partial<Task> = { title: title.trim(), important: k === 'importante', position: Date.now() % 1e9 }
    if (list) base.list_id = list.id
    if (k === 'planejado') base.due_on = todayYmd()
    await insert<Task>('tasks', base); setTitle('')
  }
  return (
    <section className="stack" aria-label={smart?.name ?? list!.name}>
      {!desktop && <button className="btn ghost small" style={{ alignSelf: 'flex-start', paddingLeft: 0 }} onClick={() => nav('/tarefas')}><Icon name="back" size={16} />Listas</button>}
      <div className="row between">
        <div className="row">
          <span style={{ color: `var(--${smart?.color ?? 'neutro'}-fg)` }}><Icon name={smart?.icon ?? 'list'} size={28} /></span>
          {renaming && list ? (
            <form onSubmit={async (e) => { e.preventDefault(); setRenaming(false) }}>
              <input className="input" autoFocus defaultValue={list.name} maxLength={60} onBlur={(e) => { if (e.target.value.trim()) update<List>('lists', list.id, { name: e.target.value.trim() }); setRenaming(false) }} aria-label="Nome da lista" />
            </form>
          ) : <h1 className="serif" style={{ fontSize: 40, lineHeight: '44px', margin: 0 }} onDoubleClick={() => setRenaming(true)}>{smart?.name ?? list!.name}</h1>}
        </div>
        {list && !DEMO && list.owner_id && list.owner_id !== me && (
          <button className="btn ghost small" onClick={async () => { if (confirm('Sair desta lista partilhada?')) { await removeWhere('list_members', { list_id: list.id, user_id: me! }); nav('/tarefas') } }}>Sair da lista</button>
        )}
        {list && (DEMO || !list.owner_id || list.owner_id === me) && (
          <div className="row" style={{ gap: 6 }}>
            {!DEMO && <button className="icon-btn" aria-label="Partilhar lista" onClick={() => setSharing(true)} style={members.length ? { background: 'var(--ink)', color: 'var(--on-ink)' } : undefined}><Icon name="users" size={18} /></button>}
            <button className="icon-btn" aria-label="Renomear lista" onClick={() => setRenaming(true)}><Icon name="note" size={18} /></button>
            <button className="icon-btn" aria-label="Apagar lista" onClick={async () => { if (confirm(`Apagar a lista “${list.name}” e as tarefas dela?`)) { await remove('lists', list.id); nav('/tarefas') } }}><Icon name="trash" size={18} /></button>
          </div>
        )}
      </div>
      {list && !DEMO && (list.owner_id !== me || members.length > 0) && (
        <div className="banner row"><Icon name="users" size={16} /><span>
          {list.owner_id !== me ? `Lista partilhada por ${people.find((p) => p.id === list.owner_id)?.display_name ?? 'alguém do grupo'}.` : `Partilhada com ${members.map((m) => people.find((p) => p.id === m.user_id)?.display_name ?? 'alguém').join(', ')}.`}
        </span></div>
      )}
      {list && sharing && (
        <Sheet open onClose={() => setSharing(false)} title="Partilhar lista" labelledBy="share-sheet">
          <p className="muted" style={{ margin: 0 }}>Quem você escolher vê e edita as tarefas desta lista. Só aparece quem está num grupo com você.</p>
          {people.filter((p) => p.id !== me).length ? (
            <div className="card flush list" style={{ background: 'var(--bg-canvas)' }}>
              {people.filter((p) => p.id !== me).map((p) => {
                const on = members.some((m) => m.user_id === p.id)
                return (
                  <div key={p.id} className="list-row"><span className="grow">{p.display_name || 'Sem nome'}</span>
                    <Toggle label={`Partilhar com ${p.display_name}`} on={on} onChange={(v) => (v ? insertPlain('list_members', { list_id: list.id, user_id: p.id }) : removeWhere('list_members', { list_id: list.id, user_id: p.id }))} /></div>
                )
              })}
            </div>
          ) : <Empty>Ninguém ainda. Crie um grupo e convide alguém em <Link className="link" to="/grupo">Grupo</Link>.</Empty>}
        </Sheet>
      )}
      <form className="card row" style={{ padding: '6px 16px', boxShadow: 'inset 0 0 0 1.5px var(--ink)' }} onSubmit={(e) => { e.preventDefault(); add() }}>
        <Icon name="plus" />
        <input className="input bare grow" style={{ height: 44 }} value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} placeholder="Adicionar uma tarefa" aria-label="Nova tarefa" />
      </form>
      <div className="card flush list">
        {open.length ? open.map((t) => <TaskRow key={t.id} task={t} lists={lists} areas={areas} />) : <div className="list-row muted caption">Nada por aqui.</div>}
      </div>
      {done.length > 0 && (
        <>
          <button className="row medium" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
            <span style={{ transform: showDone ? 'rotate(90deg)' : undefined, display: 'inline-flex' }}><Icon name="chevron" size={16} /></span>Concluídas <span className="muted">{done.length}</span>
          </button>
          {showDone && <div className="card flush list">{done.map((t) => <TaskRow key={t.id} task={t} lists={lists} areas={areas} />)}</div>}
        </>
      )}
    </section>
  )
}

export function TarefaRoute() {
  const { id } = useParams()
  const nav = useNavigate()
  const { rows: tasks } = useRows<Task>('tasks')
  const task = tasks.find((t) => t.id === id)
  return (
    <>
      <Tarefas />
      <Sheet open={!!task} onClose={() => nav(-1)} labelledBy="task-title">{task && <TaskDetail task={task} onClose={() => nav(-1)} />}</Sheet>
    </>
  )
}

