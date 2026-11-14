-- Dream Board · Grupo como no Figma: 4 níveis de privacidade, exceções por área, metas visíveis,
-- incentivos, o que funcionou no check-in, quem faz o quê e conversa nas tarefas partilhadas.
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.

-- 0. Segurança: cada pessoa só muda a própria privacidade (antes dava para mudar o próprio papel para admin).
revoke update on public.group_members from authenticated;
alter table public.group_members add column if not exists shown_goal_area_ids uuid[] not null default '{}';
grant update (share, hidden_area_ids, shown_goal_area_ids) on public.group_members to authenticated;

-- 1. Quatro níveis: nada · placar e intenção · placar + metas · tudo (também passos e hábitos).
--    'score' passa a ser “placar e intenção” (o recomendado), 'goals' é novo.
alter type public.share_mode add value if not exists 'goals' before 'all';

-- 2. Check-in: “o que funcionou (para o grupo copiar)”.
alter table public.checkins add column if not exists worked text check (char_length(worked) <= 500);

-- 3. Convites: quem entrou por cada link (para mostrar “Lu · entrou” / “convite enviado”).
alter table public.group_invites add column if not exists used_by uuid references auth.users(id) on delete set null;

create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.group_invites; begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'invalid invite'; end if;
  select * into inv from public.group_invites
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   for update;
  if not found then raise exception 'invalid invite'; end if;
  if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = (select auth.uid())) then
    return inv.group_id;
  end if;
  if inv.used_at is not null or inv.expires_at <= now() then raise exception 'invalid invite'; end if;
  if (select count(*) from public.group_members where group_id = inv.group_id) >= 8 then raise exception 'group full'; end if;
  insert into public.group_members (group_id, user_id) values (inv.group_id, (select auth.uid()));
  update public.group_invites set used_at = now(), used_by = (select auth.uid()) where id = inv.id;
  return inv.group_id;
end $$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- 4. Placar do grupo: agora com o que funcionou, e intenção a partir de “placar e intenção”.
drop function if exists public.group_scores(uuid, smallint);
create or replace function public.group_scores(p_group uuid, p_week smallint)
returns table (user_id uuid, score smallint, intention text, worked text)
language sql stable security definer set search_path = '' as $$
  select c.owner_id,
         case when m.share <> 'nothing' then c.score end,
         case when m.share <> 'nothing' then c.intention end,
         case when m.share <> 'nothing' then c.worked end
  from public.checkins c join public.group_members m on m.group_id = c.group_id and m.user_id = c.owner_id
  where c.group_id = p_group and c.week = p_week and public.is_group_member(p_group);
$$;
revoke all on function public.group_scores(uuid, smallint) from public, anon;
grant execute on function public.group_scores(uuid, smallint) to authenticated;

-- 5. Metas visíveis no grupo, respeitando o nível e as exceções por área de cada pessoa.
--    Metas da área fixa (Finanças) nunca aparecem. Passos e hábitos só no nível “tudo”.
create or replace function public.group_plans(p_group uuid)
returns table (user_id uuid, goal_id uuid, title text, done_definition text, area_name text, area_color text,
               steps_done int, steps_total int, week_steps text[], habits text[])
language sql stable security definer set search_path = '' as $$
  with me as (select public.is_group_member(p_group) as ok),
  mem as (select * from public.group_members where group_id = p_group),
  cyc as (
    select distinct on (c.owner_id) c.owner_id, c.id, c.starts_on
    from public.cycles c join mem on mem.user_id = c.owner_id
    where c.status = 'active' order by c.owner_id, c.starts_on desc)
  select g.owner_id, g.id, g.title, g.done_definition, a.name, a.color::text,
         (select count(*) from public.steps s where s.goal_id = g.id and s.done_at is not null)::int,
         (select count(*) from public.steps s where s.goal_id = g.id)::int,
         case when m.share::text = 'all' then array(
           select s.title from public.steps s
            where s.goal_id = g.id and s.week = greatest(1, least(12, ((current_date - cyc.starts_on) / 7) + 1))
            order by s.position) else '{}' end,
         case when m.share::text = 'all' then array(
           select h.title from public.habits h where h.owner_id = g.owner_id and not h.archived and h.area_id is not distinct from g.area_id order by h.created_at) else '{}' end
  from me, public.goals g
  join cyc on cyc.id = g.cycle_id
  join mem m on m.user_id = g.owner_id
  left join public.areas a on a.id = g.area_id
  where me.ok
    and (a.id is null or not a.is_fixed)
    and not (g.area_id = any (m.hidden_area_ids))
    and (m.share::text in ('goals', 'all') or g.area_id = any (m.shown_goal_area_ids))
  order by g.owner_id, g.position;
$$;
revoke all on function public.group_plans(uuid) from public, anon;
grant execute on function public.group_plans(uuid) to authenticated;

-- 6. Incentivos (“Mande um incentivo”): de uma pessoa para outra, na semana do grupo.
create table if not exists public.cheers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  week smallint not null check (week between 1 and 5000),
  from_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  to_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null default '👏' check (char_length(emoji) <= 8),
  created_at timestamptz not null default now(),
  unique (group_id, week, from_id, to_id),
  check (from_id <> to_id)
);
alter table public.cheers enable row level security;
alter table public.cheers force row level security;
revoke all on public.cheers from anon;
drop policy if exists "incentivo lê" on public.cheers;
drop policy if exists "incentivo manda" on public.cheers;
drop policy if exists "incentivo desfaz" on public.cheers;
create policy "incentivo lê" on public.cheers for select to authenticated using (public.is_group_member(group_id));
create policy "incentivo manda" on public.cheers for insert to authenticated
  with check (from_id = (select auth.uid()) and public.is_group_member(group_id)
              and exists (select 1 from public.group_members m where m.group_id = cheers.group_id and m.user_id = cheers.to_id));
create policy "incentivo desfaz" on public.cheers for delete to authenticated using (from_id = (select auth.uid()));
create index if not exists cheers_group_week on public.cheers (group_id, week);

-- 7. Tarefas partilhadas: quem faz cada etapa, e uma conversa.
alter table public.task_items add column if not exists assignee uuid references auth.users(id) on delete set null;

create or replace function public.can_see_task(p_task uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tasks t where t.id = p_task
    and (t.owner_id = (select auth.uid()) or (t.list_id is not null and public.is_list_member(t.list_id))));
$$;
revoke all on function public.can_see_task(uuid) from public, anon;
grant execute on function public.can_see_task(uuid) to authenticated;

create table if not exists public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  author_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);
alter table public.task_comments enable row level security;
alter table public.task_comments force row level security;
revoke all on public.task_comments from anon;
drop policy if exists "conversa lê" on public.task_comments;
drop policy if exists "conversa escreve" on public.task_comments;
drop policy if exists "conversa apaga" on public.task_comments;
create policy "conversa lê" on public.task_comments for select to authenticated using (public.can_see_task(task_id));
create policy "conversa escreve" on public.task_comments for insert to authenticated with check (author_id = (select auth.uid()) and public.can_see_task(task_id));
create policy "conversa apaga" on public.task_comments for delete to authenticated using (author_id = (select auth.uid()));
create index if not exists task_comments_task on public.task_comments (task_id, created_at);

-- quem pode ser responsável por uma etapa: só quem vê a tarefa
create or replace function public.check_assignee() returns trigger
language plpgsql security definer set search_path = '' as $$ begin
  if new.assignee is not null and not exists (
    select 1 from public.tasks t left join public.lists l on l.id = t.list_id
     where t.id = new.task_id and (new.assignee = t.owner_id or new.assignee = l.owner_id
       or exists (select 1 from public.list_members lm where lm.list_id = t.list_id and lm.user_id = new.assignee))) then
    raise exception 'assignee must see the task';
  end if;
  return new;
end $$;
drop trigger if exists check_assignee on public.task_items;
create trigger check_assignee before insert or update of assignee on public.task_items for each row execute function public.check_assignee();
