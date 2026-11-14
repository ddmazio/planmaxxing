-- Dream Board · notificações (Web Push): preferências, aparelhos inscritos, registro do que já foi enviado.
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.

-- 1. Preferências (horários, o que avisar, não perturbar) e consentimentos ficam no perfil.
alter table public.profiles add column if not exists notify jsonb not null default '{}'::jsonb;

-- 2. Aparelhos que aceitaram receber avisos.
create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (char_length(endpoint) between 10 and 1000 and endpoint like 'https://%'),
  p256dh text not null check (char_length(p256dh) between 40 and 200),
  auth text not null check (char_length(auth) between 10 and 100),
  device text check (char_length(device) <= 120),
  created_at timestamptz not null default now()
);
alter table public.push_subscriptions enable row level security;
alter table public.push_subscriptions force row level security;
revoke all on public.push_subscriptions from anon;
drop policy if exists "aparelho lê" on public.push_subscriptions;
drop policy if exists "aparelho cria" on public.push_subscriptions;
drop policy if exists "aparelho apaga" on public.push_subscriptions;
create policy "aparelho lê" on public.push_subscriptions for select to authenticated using (owner_id = (select auth.uid()));
create policy "aparelho cria" on public.push_subscriptions for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "aparelho apaga" on public.push_subscriptions for delete to authenticated using (owner_id = (select auth.uid()));
create index if not exists push_subscriptions_owner on public.push_subscriptions (owner_id);

-- 3. O que já foi avisado (para não repetir). Só o servidor lê e escreve.
create table if not exists public.notify_log (
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (char_length(kind) <= 30),
  key text not null check (char_length(key) <= 200),
  sent_at timestamptz not null default now(),
  primary key (owner_id, kind, key)
);
alter table public.notify_log enable row level security;
alter table public.notify_log force row level security;
revoke all on public.notify_log from anon, authenticated;
create index if not exists notify_log_sent on public.notify_log (sent_at);

-- 4. Chaves VAPID: geradas pela própria função na primeira vez e guardadas no Vault.
create or replace function public.push_vapid() returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'dreamboard_vapid' limit 1
$$;
revoke all on function public.push_vapid() from public, anon, authenticated;
grant execute on function public.push_vapid() to service_role;

create or replace function public.push_vapid_init(p_value text) returns void
language plpgsql security definer set search_path = '' as $$ begin
  if not exists (select 1 from vault.secrets where name = 'dreamboard_vapid') then
    perform vault.create_secret(p_value, 'dreamboard_vapid', 'Chaves dos avisos (Web Push) do Dream Board');
  end if;
end $$;
revoke all on function public.push_vapid_init(text) from public, anon, authenticated;
grant execute on function public.push_vapid_init(text) to service_role;

-- só a parte pública, para o navegador se inscrever
create or replace function public.push_public_key() returns text
language sql stable security definer set search_path = '' as $$
  select (decrypted_secret::jsonb) ->> 'publicKey' from vault.decrypted_secrets where name = 'dreamboard_vapid' limit 1
$$;
revoke all on function public.push_public_key() from public, anon;
grant execute on function public.push_public_key() to authenticated;

-- 5. A cada 5 minutos o banco chama a função notify (mesma senha interna da sincronização).
create or replace function public.notify_ping() returns void
language plpgsql security definer set search_path = '' as $$ begin
  perform net.http_post(
    url := 'https://xtydiishawnybhoxhofw.supabase.co/functions/v1/notify',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-sync-secret', public.sync_secret()),
    body := '{}'::jsonb,
    timeout_milliseconds := 5000
  );
  delete from public.notify_log where sent_at < now() - interval '40 days';
end $$;
revoke all on function public.notify_ping() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'dreamboard-notify') then perform cron.unschedule('dreamboard-notify'); end if;
  perform cron.schedule('dreamboard-notify', '*/5 * * * *', 'select public.notify_ping()');
end $$;
