-- Dream Board · dona do app: quem pode convidar, bloquear e apagar contas (página Configurações → Administração).
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.
-- Quem é admin fica numa tabela que ninguém lê pelo app; a função "admin" (servidor) confere antes de cada ação.

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.app_admins enable row level security;
alter table public.app_admins force row level security;
revoke all on public.app_admins from public, anon, authenticated;
grant all on public.app_admins to service_role;

-- só responde "sou admin?" sobre a própria pessoa
create or replace function public.am_i_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.app_admins where user_id = (select auth.uid()))
$$;
revoke all on function public.am_i_admin() from public, anon;
grant execute on function public.am_i_admin() to authenticated;
