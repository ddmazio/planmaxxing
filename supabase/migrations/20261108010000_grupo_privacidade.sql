-- Dream Board · ajustes para as etapas 2 e 4
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.

-- 1. Check-ins: cada pessoa lê direto só os seus. O grupo vê pelo group_scores(),
--    que respeita a escolha de privacidade (nada / só placar / tudo).
drop policy if exists "check-in lê" on public.checkins;
create policy "check-in lê" on public.checkins for select to authenticated using (owner_id = (select auth.uid()));

-- 2. A semana do check-in passa a contar desde a criação do grupo (não depende do ciclo de cada um).
alter table public.checkins drop constraint if exists checkins_week_check;
alter table public.checkins add constraint checkins_week_check check (week between 1 and 5000);

-- 3. Convite: também confere o limite de 8 pessoas na hora de aceitar.
create or replace function public.accept_invite(p_token text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.group_invites; begin
  if (select auth.uid()) is null then raise exception 'not authenticated'; end if;
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then raise exception 'invalid invite'; end if;
  select * into inv from public.group_invites
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
   for update;
  if not found then raise exception 'invalid invite'; end if;
  -- quem já está no grupo (ex.: abriu o link duas vezes) só volta para ele
  if exists (select 1 from public.group_members where group_id = inv.group_id and user_id = (select auth.uid())) then
    return inv.group_id;
  end if;
  if inv.used_at is not null or inv.expires_at <= now() then raise exception 'invalid invite'; end if;
  if (select count(*) from public.group_members where group_id = inv.group_id) >= 8 then raise exception 'group full'; end if;
  insert into public.group_members (group_id, user_id) values (inv.group_id, (select auth.uid()));
  update public.group_invites set used_at = now() where id = inv.id;
  return inv.group_id;
end $$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- 4. Ao sair de um grupo, a pessoa deixa de ver as listas partilhadas por quem ficou nesse grupo
--    (se não partilhar outro grupo com o dono da lista).
create or replace function public.cleanup_list_members() returns trigger
language plpgsql security definer set search_path = '' as $$ begin
  delete from public.list_members lm using public.lists l
   where lm.list_id = l.id
     and ((lm.user_id = old.user_id and not exists (
            select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
             where a.user_id = old.user_id and b.user_id = l.owner_id))
       or (l.owner_id = old.user_id and not exists (
            select 1 from public.group_members a join public.group_members b on a.group_id = b.group_id
             where a.user_id = lm.user_id and b.user_id = old.user_id)));
  return old;
end $$;
drop trigger if exists cleanup_list_members on public.group_members;
create trigger cleanup_list_members after delete on public.group_members
  for each row execute function public.cleanup_list_members();
