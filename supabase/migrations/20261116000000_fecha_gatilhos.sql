-- Dream Board · funções de gatilho não são chamadas por ninguém de fora: tira a permissão de execução pública.
-- (O banco continua rodando os gatilhos normalmente.) Pode rodar mais de uma vez.
revoke execute on function public.check_assignee() from public, anon, authenticated;
revoke execute on function public.cleanup_list_members() from public, anon, authenticated;
revoke execute on function public.enqueue_event_sync() from public, anon, authenticated;
revoke execute on function public.enqueue_sync() from public, anon, authenticated;
revoke execute on function public.integration_cleanup() from public, anon, authenticated;
