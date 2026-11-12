-- Dream Board · sincronização automática (Google Agenda a cada 15 min, Microsoft To Do nos dois sentidos)
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.
--
-- Segurança:
--   * As chaves permanentes (refresh tokens) ficam no Vault do Supabase, criptografadas.
--     Nenhuma tabela que o app lê tem a chave. Só as funções do servidor (service_role) chegam nela.
--   * O app vê só o estado da ligação (ligada, última sincronização, erro) e pode desligar.
--   * Mudanças vindas de fora entram por uma função que marca a sessão como "sincronizando",
--     para não voltarem para a fila de envio (sem eco infinito).

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

-- ---------------------------------------------------------------- ids de fora
alter table public.lists add column if not exists external_id text check (char_length(external_id) <= 400);
alter table public.tasks add column if not exists external_id text check (char_length(external_id) <= 400);
create unique index if not exists lists_external_id_key on public.lists (external_id);
create unique index if not exists tasks_external_id_key on public.tasks (external_id);

-- ---------------------------------------------------------------- integrações
create table if not exists public.integrations (
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  provider text not null check (provider in ('google', 'microsoft')),
  account_email text check (char_length(account_email) <= 320),
  status text not null default 'active' check (status in ('active', 'error')),
  last_sync_at timestamptz,
  last_full_sync_at timestamptz,
  last_error text check (char_length(last_error) <= 1000),
  state jsonb not null default '{}'::jsonb,
  token_secret_id uuid,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider)
);
alter table public.integrations enable row level security;
alter table public.integrations force row level security;
revoke all on public.integrations from anon, authenticated;
-- o app só lê o estado (nunca o estado interno nem a referência da chave) e pode desligar
grant select (owner_id, provider, account_email, status, last_sync_at, last_error, created_at) on public.integrations to authenticated;
grant delete on public.integrations to authenticated;
drop policy if exists "dono lê" on public.integrations;
drop policy if exists "dono desliga" on public.integrations;
create policy "dono lê" on public.integrations for select to authenticated using (owner_id = (select auth.uid()));
create policy "dono desliga" on public.integrations for delete to authenticated using (owner_id = (select auth.uid()));
drop trigger if exists set_updated_at on public.integrations;
create trigger set_updated_at before update on public.integrations for each row execute function public.set_updated_at();

-- ao desligar, a chave sai do Vault e a fila daquela pessoa é limpa
create or replace function public.integration_cleanup() returns trigger
language plpgsql security definer set search_path = '' as $$ begin
  if old.token_secret_id is not null then delete from vault.secrets where id = old.token_secret_id; end if;
  delete from public.sync_outbox where owner_id = old.owner_id and provider = old.provider;
  if old.provider = 'microsoft' then
    -- as listas e tarefas ficam no app, só deixam de estar ligadas ao To Do
    perform set_config('app.syncing', '1', true);
    update public.tasks set external_id = null where external_id like 'ms:%' and owner_id = old.owner_id;
    update public.lists set external_id = null where external_id like 'ms:%' and owner_id = old.owner_id;
  end if;
  return old;
end $$;

-- ---------------------------------------------------------------- fila de envio (app → To Do)
create table if not exists public.sync_outbox (
  id bigint generated always as identity primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  kind text not null check (kind in ('task', 'list')),
  op text not null check (op in ('upsert', 'delete')),
  entity_id uuid not null,
  external_id text,
  created_at timestamptz not null default now()
);
alter table public.sync_outbox enable row level security;
alter table public.sync_outbox force row level security;
revoke all on public.sync_outbox from anon, authenticated;
create index if not exists sync_outbox_owner on public.sync_outbox (owner_id, id);

drop trigger if exists integration_cleanup on public.integrations;
create trigger integration_cleanup after delete on public.integrations for each row execute function public.integration_cleanup();

-- ---------------------------------------------------------------- avisar o servidor
create or replace function public.sync_secret() returns text
language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'dreamboard_sync_secret' limit 1
$$;
revoke all on function public.sync_secret() from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'dreamboard_sync_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'dreamboard_sync_secret', 'Senha interna entre o banco e a função sync');
  end if;
end $$;

create or replace function public.sync_ping(p_owner uuid default null) returns void
language plpgsql security definer set search_path = '' as $$ begin
  perform net.http_post(
    url := 'https://xtydiishawnybhoxhofw.supabase.co/functions/v1/sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', public.sync_secret()),
    body := jsonb_build_object('owner', p_owner),
    timeout_milliseconds := 5000
  );
end $$;
revoke all on function public.sync_ping(uuid) from public, anon, authenticated;
grant execute on function public.sync_ping(uuid) to service_role;

-- ---------------------------------------------------------------- gatilho: mudanças no app vão para a fila
create or replace function public.enqueue_sync() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_owner uuid; v_kind text; v_id uuid; v_ext text; v_list uuid;
begin
  if coalesce(current_setting('app.syncing', true), '') = '1' then return null; end if;
  if tg_table_name = 'lists' then
    v_kind := 'list';
    v_owner := coalesce(new.owner_id, old.owner_id);
    v_id := coalesce(new.id, old.id);
    v_ext := coalesce(old.external_id, new.external_id);
  else
    v_kind := 'task';
    v_id := coalesce(new.id, old.id);
    v_ext := coalesce(old.external_id, new.external_id);
    v_list := case when tg_op = 'DELETE' then old.list_id else new.list_id end;
    if v_list is null then v_owner := coalesce(new.owner_id, old.owner_id);
    else select owner_id into v_owner from public.lists where id = v_list; end if;
    -- tarefa de uma lista que acabou de ser apagada: a lista inteira sai do To Do de uma vez
    if v_owner is null then v_owner := coalesce(new.owner_id, old.owner_id); end if;
  end if;
  if not exists (select 1 from public.integrations where owner_id = v_owner and provider = 'microsoft') then return null; end if;
  -- só interessa o que muda no To Do
  if tg_op = 'UPDATE' then
    if v_kind = 'task' then
      if (new.title, new.notes, new.important, new.due_on, new.remind_at, new.repeat_rule, new.completed_at, new.list_id)
         is not distinct from (old.title, old.notes, old.important, old.due_on, old.remind_at, old.repeat_rule, old.completed_at, old.list_id) then return null; end if;
    elsif new.name is not distinct from old.name then return null;
    end if;
  end if;
  insert into public.sync_outbox (owner_id, provider, kind, op, entity_id, external_id)
  values (v_owner, 'microsoft', v_kind, case when tg_op = 'DELETE' then 'delete' else 'upsert' end, v_id, v_ext);
  perform public.sync_ping(v_owner);
  return null;
end $$;
drop trigger if exists enqueue_sync on public.tasks;
create trigger enqueue_sync after insert or update or delete on public.tasks for each row execute function public.enqueue_sync();
drop trigger if exists enqueue_sync on public.lists;
create trigger enqueue_sync after insert or update or delete on public.lists for each row execute function public.enqueue_sync();

-- ---------------------------------------------------------------- funções só do servidor (service_role)
create or replace function public.integration_save(p_owner uuid, p_provider text, p_email text, p_token text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_secret uuid;
begin
  select token_secret_id into v_secret from public.integrations where owner_id = p_owner and provider = p_provider;
  if v_secret is not null and exists (select 1 from vault.secrets where id = v_secret) then
    perform vault.update_secret(v_secret, p_token);
  else
    v_secret := vault.create_secret(p_token, 'dreamboard_' || p_provider || '_' || p_owner::text || '_' || extract(epoch from now())::bigint, 'Chave de sincronização');
  end if;
  insert into public.integrations (owner_id, provider, account_email, status, token_secret_id, last_error)
  values (p_owner, p_provider, p_email, 'active', v_secret, null)
  on conflict (owner_id, provider) do update set account_email = coalesce(excluded.account_email, public.integrations.account_email),
    status = 'active', token_secret_id = v_secret, last_error = null;
end $$;

create or replace function public.integration_token(p_owner uuid, p_provider text) returns text
language sql security definer set search_path = '' as $$
  select s.decrypted_secret from public.integrations i join vault.decrypted_secrets s on s.id = i.token_secret_id
  where i.owner_id = p_owner and i.provider = p_provider
$$;

create or replace function public.sync_secret_ok(p_secret text) returns boolean
language sql security definer set search_path = '' as $$ select p_secret is not null and p_secret = public.sync_secret() $$;

create or replace function public.sync_take_outbox(p_owner uuid, p_limit int default 200) returns setof public.sync_outbox
language sql security definer set search_path = '' as $$
  delete from public.sync_outbox where id in (
    select id from public.sync_outbox where owner_id = p_owner order by id limit p_limit for update skip locked
  ) returning *
$$;

-- grava o que veio do To Do sem voltar para a fila; só aplica se a versão de fora for mais nova
create or replace function public.sync_apply_ms(p_owner uuid, p_lists jsonb, p_tasks jsonb, p_removed text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare r jsonb; v_list uuid; v_id uuid;
begin
  perform set_config('app.syncing', '1', true);
  for r in select * from jsonb_array_elements(coalesce(p_lists, '[]')) loop
    update public.lists set name = r->>'name' where external_id = r->>'external_id' and name is distinct from r->>'name';
    if not found and not exists (select 1 from public.lists where external_id = r->>'external_id') then
      -- liga a uma lista do app com o mesmo nome, se houver; senão cria
      select id into v_id from public.lists where owner_id = p_owner and external_id is null and lower(name) = lower(r->>'name') limit 1;
      if v_id is not null then update public.lists set external_id = r->>'external_id' where id = v_id;
      else insert into public.lists (owner_id, name, external_id, position) values (p_owner, left(r->>'name', 60), r->>'external_id', coalesce((r->>'position')::int, 0)); end if;
    end if;
  end loop;
  for r in select * from jsonb_array_elements(coalesce(p_tasks, '[]')) loop
    v_list := null;
    if r->>'list_external_id' is not null then select id into v_list from public.lists where external_id = r->>'list_external_id'; end if;
    select id into v_id from public.tasks where external_id = r->>'external_id';
    if v_id is null then
      insert into public.tasks (owner_id, list_id, title, notes, important, due_on, remind_at, repeat_rule, completed_at, external_id)
      values (p_owner, v_list, left(r->>'title', 300), left(r->>'notes', 5000), coalesce((r->>'important')::boolean, false),
        (r->>'due_on')::date, (r->>'remind_at')::timestamptz, r->>'repeat_rule', (r->>'completed_at')::timestamptz, r->>'external_id');
    else
      update public.tasks set list_id = v_list, title = left(r->>'title', 300), notes = left(r->>'notes', 5000),
        important = coalesce((r->>'important')::boolean, false), due_on = (r->>'due_on')::date, remind_at = (r->>'remind_at')::timestamptz,
        repeat_rule = case when r ? 'repeat_rule' and r->>'repeat_rule' is not null then r->>'repeat_rule' else repeat_rule end,
        completed_at = (r->>'completed_at')::timestamptz
      where id = v_id and updated_at <= (r->>'modified_at')::timestamptz;
    end if;
  end loop;
  delete from public.tasks where external_id = any(coalesce(p_removed, '{}'));
  delete from public.lists where external_id = any(coalesce(p_removed, '{}'));
end $$;

-- uma sincronização por pessoa e serviço de cada vez (o cron e os avisos podem chegar juntos)
create or replace function public.sync_lease(p_owner uuid, p_provider text, p_seconds int) returns boolean
language plpgsql security definer set search_path = '' as $$ begin
  update public.integrations set locked_until = case when p_seconds > 0 then now() + make_interval(secs => p_seconds) else null end
   where owner_id = p_owner and provider = p_provider and (p_seconds <= 0 or locked_until is null or locked_until < now());
  return found;
end $$;

-- liga uma linha do app ao id dela no To Do (depois de criar lá), sem voltar para a fila
create or replace function public.sync_link(p_kind text, p_id uuid, p_external text) returns void
language plpgsql security definer set search_path = '' as $$ begin
  perform set_config('app.syncing', '1', true);
  if p_kind = 'list' then update public.lists set external_id = p_external where id = p_id;
  else update public.tasks set external_id = p_external where id = p_id; end if;
end $$;

do $$ declare f text; begin
  foreach f in array array['integration_save(uuid,text,text,text)', 'integration_token(uuid,text)', 'sync_secret_ok(text)',
    'sync_take_outbox(uuid,int)', 'sync_apply_ms(uuid,jsonb,jsonb,text[])', 'sync_link(text,uuid,text)', 'sync_lease(uuid,text,int)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
grant all on public.integrations, public.sync_outbox to service_role;

-- ---------------------------------------------------------------- agendamento: a cada 2 minutos
-- (a função decide: To Do a cada vez, Google a cada 15 minutos)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'dreamboard-sync') then perform cron.unschedule('dreamboard-sync'); end if;
  perform cron.schedule('dreamboard-sync', '*/2 * * * *', 'select public.sync_ping(null)');
end $$;
