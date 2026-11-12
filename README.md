# Dream Board

App de planejamento por ciclos (metas, tarefas, agenda, finanças e grupo), feito como **PWA**: abre no navegador e instala como app no iPhone, Android e Mac.

- **Frontend:** React 19 + TypeScript + Vite, `vite-plugin-pwa` (service worker só com arquivos estáticos).
- **Servidor:** Supabase (Postgres na UE, login com Google ou link por e-mail, regras de acesso por linha).
- **Hospedagem:** Vercel (cabeçalhos de segurança em `vercel.json`).

Sem as chaves do Supabase, o app abre em **modo demonstração**: tudo funciona, mas os dados ficam só naquele aparelho.

## Etapas

| Etapa | O que entra | Estado |
|---|---|---|
| 1 | Base segura, login, onboarding, Hoje, Tarefas (listas, etapas, repetir), Agenda (dia/semana/mês), entrada rápida (+), hábitos, configurações, exportar e apagar conta | ✅ |
| 2 | Finanças: resumo 50/30/20, lançamentos, regra, moedas, potes, assinaturas, sequência no azul | ✅ |
| 3 | Ciclo: plano, metas, passos, ritual em 3 partes, páginas das áreas, reflexões | ✅ |
| 4 | Grupo e partilha: convites, check-in, placar com privacidade, listas partilhadas | ✅ |

O banco (`supabase/migrations`) já está pronto para as 4 etapas.

## Rodar no computador

```bash
npm install
npm run dev        # http://localhost:5173 (modo demonstração se não houver .env.local)
npm test           # testes da entrada rápida
npm run build      # gera /dist
```

## Ligar ao Supabase (uma vez)

1. Em [supabase.com](https://supabase.com), crie um projeto na região **EU (Frankfurt ou Paris)**. Guarde a senha do banco num gerenciador de senhas.
2. **SQL Editor → New query**: cole e rode, nesta ordem, cada arquivo de `supabase/migrations/` (`20261108000000_schema.sql`, `20261108010000_grupo_privacidade.sql`, `20261108020000_google_agenda.sql`).
3. **Authentication → Providers**:
   - **Email**: ligado, com "Confirm email" ligado.
   - **Google**: ligado. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials) crie um "OAuth client ID" (Web) e use como redirect `https://SEU-PROJETO.supabase.co/auth/v1/callback`. Cole o Client ID e o Secret no Supabase.
   - **Google Agenda (opcional)**: no Google Cloud, ative a *Google Calendar API* e, em *Data access*, adicione o escopo `.../auth/calendar.readonly`.
4. **Authentication → URL Configuration**: em *Site URL* coloque o endereço do app (ex.: `https://planmaxxing.vercel.app`). Em *Redirect URLs* adicione esse mesmo endereço e `http://localhost:5173`.
5. **Project Settings → API**: copie *Project URL* e a chave **anon public** para `.env.local` (veja `.env.example`). **Nunca** use a chave `service_role` no app.

## Publicar na Vercel

1. Em [vercel.com](https://vercel.com), "Add New → Project" e importe `ddmazio/planmaxxing`.
2. Em *Environment Variables* adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
3. Deploy. Depois, volte ao passo 4 do Supabase e confira o endereço final.

Para instalar: no iPhone, abra no Safari → Compartilhar → "Adicionar à Tela de Início". No Android e no Chrome do Mac, "Instalar app".

Veja `SECURITY.md` para o que protege os dados e a lista de conferência antes de usar com outras pessoas.

## Sincronização automática (Google Agenda e Microsoft To Do)

Duas Edge Functions (`supabase/functions/connect` e `supabase/functions/sync`). Para publicar pelo painel, rode `npm run functions:bundle` e cole `supabase/functions-dist/<nome>.ts` em **Edge Functions → Deploy a new function → Via editor**, com **Verify JWT desligado** (a função confere o login ela mesma).

Segredos das funções (**Edge Functions → Secrets**): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`.

- Google Cloud: no cliente OAuth, adicione o redirect `https://SEU-PROJETO.supabase.co/functions/v1/connect` e publique o app (fora de "Testando", senão a chave vence em 7 dias).
- Microsoft (portal Azure → App registrations): contas pessoais e de organização, plataforma Web com o mesmo redirect, permissões `Tasks.ReadWrite`, `User.Read`, `offline_access`, e um client secret.
