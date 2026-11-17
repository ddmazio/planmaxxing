-- Twelvefold · Painel do app (Configurações → Painel do app), só para a dona.
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.
-- Configurações gerais, recursos em teste com liberação aos poucos, testadores e números do app.
-- As pessoas só leem as configurações gerais e quais recursos estão ligados para elas; mudar é só pela dona.

-- 1. Configurações do app (uma linha só)
create table if not exists public.app_settings (
  id boolean primary key default true check (id),
  announcement text check (char_length(announcement) <= 280),
  announcement_until date,
  announcement_at timestamptz,
  maintenance boolean not null default false,
  refresh_after timestamptz,
  default_weeks smallint not null default 12 check (default_weeks in (8, 12)),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true) on conflict do nothing;
alter table public.app_settings enable row level security;
alter table public.app_settings force row level security;
revoke all on public.app_settings from public, anon, authenticated;
grant select on public.app_settings to authenticated;
drop policy if exists app_settings_read on public.app_settings;
create policy app_settings_read on public.app_settings for select to authenticated using (true);

-- 2. Recursos em teste: owner = só a dona, testers = dona e testadores, all = todos
create table if not exists public.feature_flags (
  key text primary key check (key ~ '^[a-z_]{2,40}$'),
  rollout text not null default 'owner' check (rollout in ('owner', 'testers', 'all')),
  updated_at timestamptz not null default now()
);
insert into public.feature_flags (key, rollout) values
  ('ciclo_curto', 'owner'), ('arrastar_agenda', 'all'), ('sugestao_agora', 'all')
on conflict do nothing;
alter table public.feature_flags enable row level security;
alter table public.feature_flags force row level security;
revoke all on public.feature_flags from public, anon, authenticated;

-- 3. Testadores (acesso antecipado)
create table if not exists public.app_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_testers enable row level security;
alter table public.app_testers force row level security;
revoke all on public.app_testers from public, anon, authenticated;

-- 4. Quais recursos estão ligados para quem pergunta (a dona vê todos)
create or replace function public.my_features() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(f.key order by f.key), '{}') from public.feature_flags f
  where f.rollout = 'all'
     or exists (select 1 from public.app_admins a where a.user_id = (select auth.uid()))
     or (f.rollout = 'testers' and exists (select 1 from public.app_testers t where t.user_id = (select auth.uid())))
$$;
revoke all on function public.my_features() from public, anon;
grant execute on function public.my_features() to authenticated;

-- 5. Funções da dona (cada uma confere antes)
create or replace function public.admin_check() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.app_admins where user_id = (select auth.uid())) then
    raise exception 'Só a dona do app pode fazer isso' using errcode = '42501';
  end if;
end $$;
revoke all on function public.admin_check() from public, anon, authenticated;

-- números do app: só contagens, nunca o conteúdo de ninguém
create or replace function public.admin_panel() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public.admin_check();
  return jsonb_build_object(
    'people', (select count(*) from auth.users),
    'active_week', (select count(distinct x.owner_id) from (
        select owner_id from public.tasks where updated_at > now() - interval '7 days'
        union all select owner_id from public.steps where updated_at > now() - interval '7 days'
        union all select owner_id from public.events where updated_at > now() - interval '7 days') x),
    'invites_open', (select count(*) from auth.users where invited_at is not null and last_sign_in_at is null),
    'notifications_today', (select count(*) from public.notify_log where sent_at >= date_trunc('day', now())),
    'sync_errors', (select count(*) from public.integrations where status = 'error'),
    'sync_pending', (select count(*) from public.sync_outbox),
    'last_sync', (select max(last_sync_at) from public.integrations),
    'flags', (select coalesce(jsonb_object_agg(key, rollout), '{}'::jsonb) from public.feature_flags),
    'testers', (select coalesce(jsonb_agg(user_id), '[]'::jsonb) from public.app_testers),
    'settings', (select to_jsonb(s) from public.app_settings s where s.id)
  );
end $$;

create or replace function public.admin_set_flag(flag text, level text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_check();
  if level not in ('owner', 'testers', 'all') then raise exception 'nível inválido'; end if;
  update public.feature_flags set rollout = level, updated_at = now() where key = flag;
  if not found then raise exception 'recurso não existe'; end if;
end $$;

create or replace function public.admin_set_tester(person uuid, tester boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_check();
  if tester then insert into public.app_testers (user_id) values (person) on conflict do nothing;
  else delete from public.app_testers where user_id = person; end if;
end $$;

create or replace function public.admin_set_settings(changes jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.admin_check();
  update public.app_settings set
    announcement = case when changes ? 'announcement' then nullif(btrim(changes->>'announcement'), '') else announcement end,
    announcement_until = case when changes ? 'announcement_until' then nullif(changes->>'announcement_until', '')::date else announcement_until end,
    announcement_at = case when changes ? 'announcement' then now() else announcement_at end,
    maintenance = coalesce((changes->>'maintenance')::boolean, maintenance),
    refresh_after = case when changes ? 'refresh' then now() else refresh_after end,
    default_weeks = coalesce((changes->>'default_weeks')::smallint, default_weeks),
    updated_at = now()
  where id;
end $$;

revoke all on function public.admin_panel() from public, anon;
revoke all on function public.admin_set_flag(text, text) from public, anon;
revoke all on function public.admin_set_tester(uuid, boolean) from public, anon;
revoke all on function public.admin_set_settings(jsonb) from public, anon;
grant execute on function public.admin_panel() to authenticated;
grant execute on function public.admin_set_flag(text, text) to authenticated;
grant execute on function public.admin_set_tester(uuid, boolean) to authenticated;
grant execute on function public.admin_set_settings(jsonb) to authenticated;
