-- Twelvefold · novo ritual de início de ciclo: recompensas por área e lista de ideias (prêmios) no ciclo.
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.
-- Ficam só com a dona do ciclo (as regras de acesso de cycles já valem); o grupo não vê.
alter table public.cycles add column if not exists rewards jsonb not null default '[]'::jsonb;
alter table public.cycles add column if not exists ideas text[] not null default '{}';
alter table public.cycles drop constraint if exists cycles_rewards_check;
alter table public.cycles add constraint cycles_rewards_check check (jsonb_typeof(rewards) = 'array' and jsonb_array_length(rewards) <= 60 and octet_length(rewards::text) <= 20000);
alter table public.cycles drop constraint if exists cycles_ideas_check;
alter table public.cycles add constraint cycles_ideas_check check (cardinality(ideas) <= 60);
