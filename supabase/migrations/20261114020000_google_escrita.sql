-- Dream Board · Google Agenda com escrita: salvar compromissos lá, "nos dois sentidos" e conflitos.
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.
--
-- Como funciona:
--   * A ligação guarda se o Google deu permissão de escrita (can_write) e se a pessoa quer "nos dois sentidos" (two_way).
--   * Evento com sync_google = true vai para o Google. Com two_way, também os que vieram de lá voltam editados.
--   * Mudanças no app entram na mesma fila de envio do To Do (sync_outbox), agora com kind = 'event'.
--   * Se o evento mudou aqui e no Google desde a última sincronização, nada é sobrescrito:
--     nasce um conflito (event_conflicts) e a pessoa escolhe qual versão fica.

-- ---------------------------------------------------------------- ligação
alter table public.integrations add column if not exists can_write boolean not null default false;
alter table public.integrations add column if not exists two_way boolean not null default false;
grant select (can_write, two_way) on public.integrations to authenticated;
grant update (two_way) on public.integrations to authenticated;
drop policy if exists "dono escolhe" on public.integrations;
create policy "dono escolhe" on public.integrations for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- eventos
alter table public.events add column if not exists sync_google boolean not null default false;
alter table public.events add column if not exists remote_updated timestamptz;

-- ---------------------------------------------------------------- fila: eventos também
alter table public.sync_outbox drop constraint if exists sync_outbox_kind_check;
alter table public.sync_outbox add constraint sync_outbox_kind_check check (kind in ('task', 'list', 'event'));

-- o To Do pega só a parte dele da fila
create or replace function public.sync_take_outbox(p_owner uuid, p_limit int default 200) returns setof public.sync_outbox
language sql security definer set search_path = '' as $$
  delete from public.sync_outbox where id in (
    select id from public.sync_outbox where owner_id = p_owner and provider = 'microsoft' order by id limit p_limit for update skip locked
  ) returning *
$$;

create or replace function public.sync_take_google(p_owner uuid, p_limit int default 200) returns setof public.sync_outbox
language sql security definer set search_path = '' as $$
  delete from public.sync_outbox where id in (
    select id from public.sync_outbox where owner_id = p_owner and provider = 'google' order by id limit p_limit for update skip locked
  ) returning *
$$;
revoke all on function public.sync_take_google(uuid, int) from public, anon, authenticated;
grant execute on function public.sync_take_google(uuid, int) to service_role;

-- gatilho: o que muda no app e deve ir ao Google entra na fila
create or replace function public.enqueue_event_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_owner uuid; v_two boolean; v_go boolean;
begin
  if coalesce(current_setting('app.syncing', true), '') = '1' then return null; end if;
  -- quem grava como servidor é a própria sincronização (não volta para a fila)
  if coalesce(current_setting('role', true), '') = 'service_role'
     or coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role' then return null; end if;
  v_owner := coalesce(new.owner_id, old.owner_id);
  select two_way into v_two from public.integrations where owner_id = v_owner and provider = 'google' and can_write;
  if not found then return null; end if;
  if tg_op = 'DELETE' then
    v_go := old.external_id like 'gcal:%' and (old.sync_google or v_two);
  else
    v_go := new.sync_google or (v_two and new.external_id like 'gcal:%');
    if tg_op = 'UPDATE' and (new.title, new.starts_at, new.ends_at, new.all_day, new.location, new.notes, new.sync_google)
       is not distinct from (old.title, old.starts_at, old.ends_at, old.all_day, old.location, old.notes, old.sync_google) then return null; end if;
  end if;
  if not coalesce(v_go, false) then return null; end if;
  insert into public.sync_outbox (owner_id, provider, kind, op, entity_id, external_id)
  values (v_owner, 'google', 'event', case when tg_op = 'DELETE' then 'delete' else 'upsert' end, coalesce(new.id, old.id), coalesce(old.external_id, new.external_id));
  perform public.sync_ping(v_owner);
  return null;
end $$;
drop trigger if exists enqueue_event_sync on public.events;
create trigger enqueue_event_sync after insert or update or delete on public.events for each row execute function public.enqueue_event_sync();

-- ---------------------------------------------------------------- conflitos
create table if not exists public.event_conflicts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  event_id uuid not null unique references public.events(id) on delete cascade,
  local jsonb not null,
  remote jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.event_conflicts enable row level security;
alter table public.event_conflicts force row level security;
revoke all on public.event_conflicts from anon, authenticated;
grant select on public.event_conflicts to authenticated;
grant all on public.event_conflicts to service_role;
drop policy if exists "dono lê" on public.event_conflicts;
create policy "dono lê" on public.event_conflicts for select to authenticated using (owner_id = (select auth.uid()));

-- a pessoa escolhe: 'app' (manda a versão daqui ao Google) ou 'google' (fica a de lá)
create or replace function public.resolve_event_conflict(p_id uuid, p_keep text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.event_conflicts; v_ext text;
begin
  select * into c from public.event_conflicts where id = p_id and owner_id = auth.uid();
  if not found then raise exception 'conflito não encontrado'; end if;
  if p_keep not in ('app', 'google') then raise exception 'escolha inválida'; end if;
  perform set_config('app.syncing', '1', true);
  if p_keep = 'google' then
    update public.events set
      title = left(coalesce(c.remote ->> 'title', title), 200),
      starts_at = coalesce((c.remote ->> 'starts_at')::timestamptz, starts_at),
      ends_at = coalesce((c.remote ->> 'ends_at')::timestamptz, ends_at),
      all_day = coalesce((c.remote ->> 'all_day')::boolean, all_day),
      location = left(c.remote ->> 'location', 200),
      notes = left(c.remote ->> 'notes', 5000),
      remote_updated = (c.remote ->> 'updated')::timestamptz
    where id = c.event_id;
  else
    update public.events set remote_updated = (c.remote ->> 'updated')::timestamptz where id = c.event_id returning external_id into v_ext;
    insert into public.sync_outbox (owner_id, provider, kind, op, entity_id, external_id) values (c.owner_id, 'google', 'event', 'upsert', c.event_id, v_ext);
    perform public.sync_ping(c.owner_id);
  end if;
  delete from public.event_conflicts where id = p_id;
end $$;
revoke all on function public.resolve_event_conflict(uuid, text) from public, anon;
grant execute on function public.resolve_event_conflict(uuid, text) to authenticated;
