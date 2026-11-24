-- Twelvefold · datas importantes do ciclo, marcadas no ritual (aparecem no Plano do ciclo).
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.
alter table public.cycles add column if not exists key_dates jsonb not null default '[]'::jsonb;
alter table public.cycles drop constraint if exists cycles_key_dates_check;
alter table public.cycles add constraint cycles_key_dates_check check (jsonb_typeof(key_dates) = 'array' and jsonb_array_length(key_dates) <= 120 and octet_length(key_dates::text) <= 40000);
