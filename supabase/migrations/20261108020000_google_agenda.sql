-- Dream Board · importar eventos do Google Agenda
-- Rode no Supabase: SQL Editor → New query → cole tudo → Run. Pode rodar mais de uma vez.

-- Cada evento importado guarda o id dele no Google, para não duplicar ao importar de novo.
alter table public.events add column if not exists external_id text check (char_length(external_id) <= 300);
alter table public.events drop constraint if exists events_owner_external_key;
alter table public.events add constraint events_owner_external_key unique (owner_id, external_id);
