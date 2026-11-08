-- Dream Board · schema completo (todas as etapas)
-- Regras de segurança:
--   1. RLS ligado em TODAS as tabelas. Sem política = ninguém acessa.
--   2. Cada linha tem owner_id = auth.uid(); o cliente não consegue gravar para outra pessoa.
--   3. Partilha só por listas partilhadas e grupos, via funções SECURITY DEFINER com search_path fixo.
--   4. Finanças NUNCA são visíveis a outras pessoas (sem políticas de grupo nessas tabelas).
--   5. O papel "anon" não tem acesso a nada.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- utilidades
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end $$;

create type public.area_color as enum ('trabalho','estudos','saude','relacoes','financas','eu','neutro');
create type public.budget_category as enum ('needs','wants','savings');
create type public.event_kind as enum ('plan','appointment');
create type public.goal_kind as enum ('project','habit','both');
create type public.reflection_kind as enum ('review','checkin','journal','reset');
create type public.share_mode as enum ('nothing','score','all');

-- ---------------------------------------------------------------- perfil
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 80),
  birth_date date,
  gender text check (gender in ('feminino','masculino','nao_binario','prefiro_nao_dizer')),
  timezone text not null default 'Europe/Lisbon' check (char_length(timezone) <= 64),
  currency_main char(3) not null default 'EUR' check (currency_main ~ '^[A-Z]{3}$'),
  currencies_extra text[] not null default '{}' check (cardinality(currencies_extra) <= 5),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  onboarded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- cria o perfil automaticamente quando a conta é criada
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', ''), 80));
  insert into public.areas (owner_id, name, color, icon, position, is_fixed) values
    (new.id, 'Trabalho', 'trabalho', 'briefcase', 1, false),
    (new.id, 'Estudos', 'estudos', 'book', 2, false),
    (new.id, 'Saúde', 'saude', 'heart', 3, false),
    (new.id, 'Relações', 'relacoes', 'users', 4, false),
    (new.id, 'Finanças', 'financas', 'wallet', 5, true),
    (new.id, 'Eu', 'eu', 'sparkle', 6, false);
  return new;
end $$;

-- ---------------------------------------------------------------- tabelas do dono
create table public.areas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  color public.area_color not null default 'neutro',
  icon text not null default 'dot' check (char_length(icon) <= 24),
  position smallint not null default 0,
  is_fixed boolean not null default false,
  focus boolean not null default false,
  score_now numeric(3,1) check (score_now between 0 and 10),
  score_goal numeric(3,1) check (score_goal between 0 and 10),
  why text check (char_length(why) <= 2000),
  improve text check (char_length(improve) <= 2000),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.cycles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('planning','active','closed')),
  words text[] not null default '{}' check (cardinality(words) <= 10),
  who_is_she text[] not null default '{}' check (cardinality(who_is_she) <= 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on > starts_on and ends_on - starts_on <= 120)
);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cycle_id uuid not null references public.cycles(id) on delete cascade,
  area_id uuid references public.areas(id) on delete set null,
  title text not null check (char_length(title) between 1 and 200),
  done_definition text check (char_length(done_definition) <= 500),
  kind public.goal_kind not null default 'project',
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.steps (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null references public.goals(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  week smallint not null check (week between 1 and 17),
  detail text check (char_length(detail) <= 200),
  done_at timestamptz,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.habits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area_id uuid references public.areas(id) on delete set null,
  title text not null check (char_length(title) between 1 and 120),
  days smallint[] not null default '{0,1,2,3,4,5,6}' check (cardinality(days) between 1 and 7),
  reminder_time time,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.habit_logs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  habit_id uuid not null references public.habits(id) on delete cascade,
  day date not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (habit_id, day)
);

create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  all_day boolean not null default false,
  kind public.event_kind not null default 'appointment',
  area_id uuid references public.areas(id) on delete set null,
  step_id uuid references public.steps(id) on delete set null,
  location text check (char_length(location) <= 200),
  notes text check (char_length(notes) <= 5000),
  reminder_minutes smallint check (reminder_minutes between 0 and 10080),
  external_source text check (external_source in ('google')),
  external_id text check (char_length(external_id) <= 256),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at >= starts_at)
);

create table public.reflections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  cycle_id uuid references public.cycles(id) on delete set null,
  kind public.reflection_kind not null,
  week smallint check (week between 1 and 17),
  prompt text check (char_length(prompt) <= 300),
  answers text[] not null default '{}' check (cardinality(answers) <= 50),
  title text check (char_length(title) <= 200),
  score smallint check (score between 0 and 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- tarefas (com listas partilháveis)
create table public.lists (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  icon text not null default 'list' check (char_length(icon) <= 24),
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.list_members (
  list_id uuid not null references public.lists(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (list_id, user_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  list_id uuid references public.lists(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 300),
  notes text check (char_length(notes) <= 5000),
  important boolean not null default false,
  my_day date,
  due_on date,
  due_time time,
  remind_at timestamptz,
  repeat_rule text check (repeat_rule in ('daily','weekly','monthly','yearly','weekdays')),
  area_id uuid references public.areas(id) on delete set null,
  step_id uuid references public.steps(id) on delete set null,
  assignee_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.task_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  done boolean not null default false,
  position smallint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- finanças (sempre privadas)
create table public.budget_rules (
  owner_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  needs_pct smallint not null default 50,
  wants_pct smallint not null default 30,
  savings_pct smallint not null default 20,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (needs_pct >= 0 and wants_pct >= 0 and savings_pct >= 0 and needs_pct + wants_pct + savings_pct = 100)
);

create table public.incomes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item text not null check (char_length(item) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  original_amount_cents bigint check (original_amount_cents between 0 and 100000000000),
  original_currency char(3) check (original_currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18,8) check (fx_rate > 0),
  recurring boolean not null default true,
  received_on date not null default current_date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  item text not null check (char_length(item) between 1 and 120),
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  original_amount_cents bigint check (original_amount_cents between 0 and 100000000000),
  original_currency char(3) check (original_currency ~ '^[A-Z]{3}$'),
  fx_rate numeric(18,8) check (fx_rate > 0),
  category public.budget_category not null,
  recurring boolean not null default false,
  spent_on date not null default current_date,
  pot_id uuid,
  notes text check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.pots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  target_cents bigint not null check (target_cents between 1 and 100000000000),
  goal_id uuid references public.goals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.expenses add constraint expenses_pot_fk foreign key (pot_id) references public.pots(id) on delete set null;

create table public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  amount_cents bigint not null check (amount_cents between 0 and 100000000000),
  billing_day smallint not null check (billing_day between 1 and 31),
  last_used_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- grupos
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  checkin_weekday smallint not null default 1 check (checkin_weekday between 0 and 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin','member')),
  share public.share_mode not null default 'score',
  hidden_area_ids uuid[] not null default '{}',
  joined_at timestamptz not null default now(),
  primary key (group_id, user_id)
);

create table public.group_invites (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  token_hash text not null unique,
  created_by uuid not null default auth.uid() references auth.users(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '7 days',
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.checkins (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week smallint not null check (week between 1 and 17),
  score smallint check (score between 0 and 100),
  intention text check (char_length(intention) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (group_id, owner_id, week)
);

-- ---------------------------------------------------------------- índices
create index on public.areas (owner_id);
create index on public.cycles (owner_id);
create index on public.goals (owner_id, cycle_id);
create index on public.steps (owner_id, goal_id);
create index on public.habits (owner_id);
create index on public.habit_logs (owner_id, day);
create index on public.events (owner_id, starts_at);
create index on public.reflections (owner_id, created_at);
create index on public.lists (owner_id);
create index on public.list_members (user_id);
create index on public.tasks (owner_id, list_id);
create index on public.tasks (list_id);
create index on public.task_items (task_id);
create index on public.incomes (owner_id, received_on);
create index on public.expenses (owner_id, spent_on);
create index on public.pots (owner_id);
create index on public.subscriptions (owner_id);
create index on public.group_members (user_id);
create index on public.checkins (group_id, week);

-- ---------------------------------------------------------------- updated_at
do $$ declare t text; begin
  foreach t in array array['profiles','areas','cycles','goals','steps','habits','habit_logs','events','reflections','lists','tasks','task_items','budget_rules','incomes','expenses','pots','subscriptions','groups','checkins'] loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------- funções de acesso (SECURITY DEFINER, search_path fixo)
create or replace function public.is_list_member(p_list uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.lists l where l.id = p_list and l.owner_id = (select auth.uid()))
      or exists (select 1 from public.list_members m where m.list_id = p_list and m.user_id = (select auth.uid()));
$$;

create or replace function public.is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = (select auth.uid()));
$$;

create or replace function public.is_group_admin(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = (select auth.uid()) and m.role = 'admin');
$$;

create or replace function public.shares_group_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
    where a.user_id = (select auth.uid()) and b.user_id = p_user);
$$;

-- ---------------------------------------------------------------- RLS
do $$ declare t text; begin
  foreach t in array array['profiles','areas','cycles','goals','steps','habits','habit_logs','events','reflections','lists','list_members','tasks','task_items','budget_rules','incomes','expenses','pots','subscriptions','groups','group_members','group_invites','checkins'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;

-- tabelas só do dono: tudo exige owner_id = auth.uid()
do $$ declare t text; begin
  foreach t in array array['areas','cycles','goals','steps','habits','habit_logs','events','reflections','incomes','expenses','pots','subscriptions','budget_rules'] loop
    execute format($p$create policy "dono lê" on public.%I for select to authenticated using (owner_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "dono cria" on public.%I for insert to authenticated with check (owner_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "dono edita" on public.%I for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "dono apaga" on public.%I for delete to authenticated using (owner_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

-- perfil: cada um vê e edita o seu; colegas de grupo só leem pelo RPC group_profiles()
create policy "perfil próprio lê" on public.profiles for select to authenticated using (id = (select auth.uid()));
create policy "perfil próprio edita" on public.profiles for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- listas: dono gere; membros leem
create policy "lista lê" on public.lists for select to authenticated using (public.is_list_member(id));
create policy "lista cria" on public.lists for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "lista edita" on public.lists for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "lista apaga" on public.lists for delete to authenticated using (owner_id = (select auth.uid()));

create policy "membros lê" on public.list_members for select to authenticated using (public.is_list_member(list_id));
-- só o dono da lista adiciona/remove, e só pessoas com quem partilha grupo (evita expor listas a desconhecidos)
create policy "membros dono adiciona" on public.list_members for insert to authenticated
  with check (exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid())) and public.shares_group_with(user_id));
create policy "membros remove" on public.list_members for delete to authenticated
  using (user_id = (select auth.uid()) or exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid())));

-- tarefas: dono sempre; numa lista partilhada, membros leem e editam
create policy "tarefa lê" on public.tasks for select to authenticated
  using (owner_id = (select auth.uid()) or (list_id is not null and public.is_list_member(list_id)));
create policy "tarefa cria" on public.tasks for insert to authenticated
  with check (owner_id = (select auth.uid()) and (list_id is null or public.is_list_member(list_id)));
create policy "tarefa edita" on public.tasks for update to authenticated
  using (owner_id = (select auth.uid()) or (list_id is not null and public.is_list_member(list_id)))
  with check (list_id is null and owner_id = (select auth.uid()) or (list_id is not null and public.is_list_member(list_id)));
create policy "tarefa apaga" on public.tasks for delete to authenticated
  using (owner_id = (select auth.uid()) or (list_id is not null and exists (select 1 from public.lists l where l.id = list_id and l.owner_id = (select auth.uid()))));

create policy "etapa lê" on public.task_items for select to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and (t.owner_id = (select auth.uid()) or (t.list_id is not null and public.is_list_member(t.list_id)))));
create policy "etapa escreve" on public.task_items for all to authenticated
  using (exists (select 1 from public.tasks t where t.id = task_id and (t.owner_id = (select auth.uid()) or (t.list_id is not null and public.is_list_member(t.list_id)))))
  with check (exists (select 1 from public.tasks t where t.id = task_id and (t.owner_id = (select auth.uid()) or (t.list_id is not null and public.is_list_member(t.list_id)))));

-- grupos
create policy "grupo lê" on public.groups for select to authenticated using (public.is_group_member(id));
create policy "grupo cria" on public.groups for insert to authenticated with check (created_by = (select auth.uid()));
create policy "grupo edita" on public.groups for update to authenticated using (public.is_group_admin(id)) with check (public.is_group_admin(id));
create policy "grupo apaga" on public.groups for delete to authenticated using (public.is_group_admin(id));

create policy "membros do grupo lê" on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy "membro edita a própria privacidade" on public.group_members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "membro sai / admin remove" on public.group_members for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_group_admin(group_id));
-- inserção em group_members só pelas funções create_group() e accept_invite()

create policy "convites admin lê" on public.group_invites for select to authenticated using (public.is_group_admin(group_id));
create policy "convites admin apaga" on public.group_invites for delete to authenticated using (public.is_group_admin(group_id));

create policy "check-in lê" on public.checkins for select to authenticated using (public.is_group_member(group_id));
create policy "check-in cria" on public.checkins for insert to authenticated with check (owner_id = (select auth.uid()) and public.is_group_member(group_id));
create policy "check-in edita" on public.checkins for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy "check-in apaga" on public.checkins for delete to authenticated using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------- RPCs
create or replace function public.create_group(p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g uuid; begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  insert into public.groups (name, created_by) values (left(p_name, 60), (select auth.uid())) returning id into g;
  insert into public.group_members (group_id, user_id, role) values (g, (select auth.uid()), 'admin');
  return g;
end $$;

-- gera um convite; o token só é devolvido uma vez e guardado como hash
create or replace function public.create_invite(p_group uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text; begin
  if not public.is_group_admin(p_group) then raise exception 'forbidden'; end if;
  if (select count(*) from public.group_members where group_id = p_group) >= 8 then raise exception 'group full'; end if;
  tok := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.group_invites (group_id, token_hash, created_by)
  values (p_group, encode(extensions.digest(tok, 'sha256'), 'hex'), (select auth.uid()));
  return tok;
end $$;

create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.group_invites; begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  select * into inv from public.group_invites
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and used_at is null and expires_at > now()
   for update;
  if not found then raise exception 'invalid invite'; end if;
  insert into public.group_members (group_id, user_id) values (inv.group_id, (select auth.uid())) on conflict do nothing;
  update public.group_invites set used_at = now() where id = inv.id;
  return inv.group_id;
end $$;

-- nomes de quem partilha grupo comigo (sem e-mail, sem data de nascimento)
create or replace function public.group_profiles() returns table (id uuid, display_name text)
language sql stable security definer set search_path = '' as $$
  select p.id, p.display_name from public.profiles p
  where p.id = (select auth.uid()) or public.shares_group_with(p.id);
$$;

-- placar semanal partilhado, respeitando a privacidade escolhida por cada pessoa
create or replace function public.group_scores(p_group uuid, p_week smallint) returns table (user_id uuid, score smallint, intention text)
language sql stable security definer set search_path = '' as $$
  select c.owner_id, case when m.share in ('score','all') then c.score end, case when m.share = 'all' then c.intention end
  from public.checkins c join public.group_members m on m.group_id = c.group_id and m.user_id = c.owner_id
  where c.group_id = p_group and c.week = p_week and public.is_group_member(p_group);
$$;

-- apagar a conta: remove o utilizador e, em cascata, todos os dados
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = (select auth.uid());
end $$;

-- permissões: só "authenticated" executa; anon nada
do $$ declare f text; begin
  foreach f in array array['is_list_member(uuid)','is_group_member(uuid)','is_group_admin(uuid)','shares_group_with(uuid)','create_group(text)','create_invite(uuid)','accept_invite(text)','group_profiles()','group_scores(uuid,smallint)','delete_my_account()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ---------------------------------------------------------------- dono imutável
-- ninguém (nem quem partilha uma lista) consegue trocar o dono de uma linha
create or replace function public.keep_owner() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.owner_id is distinct from old.owner_id then raise exception 'owner_id is immutable'; end if;
  return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['areas','cycles','goals','steps','habits','habit_logs','events','reflections','lists','tasks','budget_rules','incomes','expenses','pots','subscriptions','checkins'] loop
    execute format('create trigger keep_owner before update on public.%I for each row execute function public.keep_owner()', t);
  end loop;
end $$;
create or replace function public.keep_group_creator() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.created_by is distinct from old.created_by then raise exception 'created_by is immutable'; end if;
  return new;
end $$;
create trigger keep_creator before update on public.groups for each row execute function public.keep_group_creator();
