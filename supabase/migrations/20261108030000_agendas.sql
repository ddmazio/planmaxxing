-- Dream Board · agendas (as do Google e a do próprio app), para mostrar ou esconder como no Google Agenda
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.

create table if not exists public.calendars (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  external_id text not null check (char_length(external_id) between 1 and 300),
  name text not null check (char_length(name) between 1 and 200),
  color text check (color ~ '^#[0-9a-fA-F]{6}$'),
  visible boolean not null default true,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, external_id)
);

alter table public.calendars enable row level security;
alter table public.calendars force row level security;
revoke all on public.calendars from anon;
grant select, insert, update, delete on public.calendars to authenticated;

drop policy if exists "dono lê" on public.calendars;
drop policy if exists "dono cria" on public.calendars;
drop policy if exists "dono edita" on public.calendars;
drop policy if exists "dono apaga" on public.calendars;
create policy "dono lê" on public.calendars for select to authenticated using (owner_id = (select auth.uid()));
create policy "dono cria" on public.calendars for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "dono edita" on public.calendars for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "dono apaga" on public.calendars for delete to authenticated using (owner_id = (select auth.uid()));

drop trigger if exists set_updated_at on public.calendars;
create trigger set_updated_at before update on public.calendars for each row execute function public.set_updated_at();
drop trigger if exists keep_owner on public.calendars;
create trigger keep_owner before update on public.calendars for each row execute function public.keep_owner();
