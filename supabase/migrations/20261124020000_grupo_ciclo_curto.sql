-- Twelvefold · Grupo: a semana atual de cada pessoa respeita a duração do ciclo dela (4, 6, 8 ou 12 semanas).
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.
create or replace function public.group_plans(p_group uuid)
returns table (user_id uuid, goal_id uuid, title text, done_definition text, area_name text, area_color text,
               steps_done int, steps_total int, week_steps text[], habits text[])
language sql stable security definer set search_path = '' as $$
  with me as (select public.is_group_member(p_group) as ok),
  mem as (select * from public.group_members where group_id = p_group),
  cyc as (
    select distinct on (c.owner_id) c.owner_id, c.id, c.starts_on, c.ends_on
    from public.cycles c join mem on mem.user_id = c.owner_id
    where c.status = 'active' order by c.owner_id, c.starts_on desc)
  select g.owner_id, g.id, g.title, g.done_definition, a.name, a.color::text,
         (select count(*) from public.steps s where s.goal_id = g.id and s.done_at is not null)::int,
         (select count(*) from public.steps s where s.goal_id = g.id)::int,
         case when m.share::text = 'all' then array(
           select s.title from public.steps s
            where s.goal_id = g.id and s.week = greatest(1, least(greatest(1, ((cyc.ends_on - cyc.starts_on + 1) / 7) - 1), ((current_date - cyc.starts_on) / 7) + 1))
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
