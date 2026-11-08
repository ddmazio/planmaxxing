-- Teste das regras de acesso (RLS). Rode num Postgres local depois de 00_stub_local_auth.sql e da migration.
-- Erros esperados: spoof de dono, lista partilhada antes do grupo, reuso de convite, troca de dono, intruso no check-in, anon.
\set ON_ERROR_STOP 0
insert into auth.users(id,email,raw_user_meta_data) values ('11111111-1111-1111-1111-111111111111','a@x','{"full_name":"Ellen"}'),('22222222-2222-2222-2222-222222222222','b@x','{"full_name":"Lu"}'),('33333333-3333-3333-3333-333333333333','c@x','{}');
select count(*) as areas_criadas from public.areas;
-- user A
set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into public.tasks(title) values ('tarefa A');
insert into public.expenses(item,amount_cents,category) values ('renda',45000,'needs');
insert into public.lists(id,name) values ('aaaaaaaa-0000-0000-0000-000000000001','Casa');
insert into public.tasks(title,list_id) values ('lista A','aaaaaaaa-0000-0000-0000-000000000001');
-- spoof owner
insert into public.tasks(title,owner_id) values ('spoof','22222222-2222-2222-2222-222222222222');
select public.create_group('Meninas') as gid \gset
select public.create_invite(:'gid') as tok \gset
-- add B to list before sharing group (should fail)
insert into public.list_members(list_id,user_id) values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
-- user B
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select count(*) as b_ve_tarefas_de_a from public.tasks;
select count(*) as b_ve_despesas_de_a from public.expenses;
select count(*) as b_ve_areas from public.areas;
select public.accept_invite(:'tok') is not null as b_entrou;
select public.accept_invite(:'tok') as reuso_convite;
select count(*) as b_ve_perfis from public.group_profiles();
select count(*) as b_ve_despesas_depois_do_grupo from public.expenses;
-- user A shares list with B now
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
insert into public.list_members(list_id,user_id) values ('aaaaaaaa-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222');
insert into public.checkins(group_id,week,score,intention) values (:'gid',5,88,'foco');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
select title as b_ve_tarefa_partilhada from public.tasks;
update public.tasks set title='editada por B' where list_id is not null;
update public.tasks set owner_id='22222222-2222-2222-2222-222222222222' where title='editada por B';
select * from public.group_scores(:'gid',5::smallint);
-- user C outsider
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
select count(*) as c_ve_tasks from public.tasks; select count(*) as c_ve_grupos from public.groups; select count(*) as c_scores from public.group_scores(:'gid',5::smallint);
insert into public.checkins(group_id,week,score) values (:'gid',5,10);
-- anon
reset role; set role anon; select count(*) from public.tasks;
