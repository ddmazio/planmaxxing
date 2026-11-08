-- Testa a migração 20261108010000: privacidade do check-in, convite e saída do grupo.
\set ON_ERROR_STOP 0
\set A '11111111-1111-1111-1111-111111111111'
\set B '22222222-2222-2222-2222-222222222222'
\set C '33333333-3333-3333-3333-333333333333'
reset role;
insert into auth.users(id,email) values (:'A','a@x'),(:'B','b@x'),(:'C','c@x');
set role authenticated;
select set_config('request.jwt.claim.sub',:'A',false);
select public.create_group('Turma') as gid \gset
select public.create_invite(:'gid') as tok \gset
insert into public.lists(id,name) values ('bbbbbbbb-0000-0000-0000-000000000001','Mercado');
-- B entra; abrir o link de novo não dá erro
select set_config('request.jwt.claim.sub',:'B',false);
select public.accept_invite(:'tok') = :'gid' as b_entrou;
select public.accept_invite(:'tok') = :'gid' as b_reabre_link_ok;
update public.group_members set share='nothing' where user_id = :'B';
insert into public.checkins(group_id,week,score,intention) values (:'gid',1,40,'segredo');
-- A partilha a lista com B e tenta ler o check-in de B direto
select set_config('request.jwt.claim.sub',:'A',false);
insert into public.list_members(list_id,user_id) values ('bbbbbbbb-0000-0000-0000-000000000001',:'B');
insert into public.checkins(group_id,week,score) values (:'gid',1,90);
select count(*) as a_le_checkins_direto_so_os_seus from public.checkins;
select user_id = :'B' as e_b, score, intention from public.group_scores(:'gid',1::smallint) order by score nulls first;
-- C usa o convite já usado e um token falso
select set_config('request.jwt.claim.sub',:'C',false);
select public.accept_invite(:'tok') as c_convite_usado;
select public.accept_invite('zz') as c_token_falso;
-- semana alta funciona
select set_config('request.jwt.claim.sub',:'A',false);
insert into public.checkins(group_id,week,score) values (:'gid',60,70);
select count(*) as a_tem_2_checkins from public.checkins;
-- B sai do grupo: perde a lista partilhada
select set_config('request.jwt.claim.sub',:'B',false);
select count(*) as b_ve_lista_antes from public.lists;
delete from public.group_members where user_id = :'B';
select count(*) as b_ve_lista_depois from public.lists;
