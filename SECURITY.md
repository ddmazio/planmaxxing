# Segurança e privacidade

## O que protege os dados

**No banco (a camada que realmente importa)**
- RLS ligado e *forçado* em todas as 22 tabelas. Sem uma política explícita, ninguém lê nada.
- Toda linha tem `owner_id` com padrão `auth.uid()`; as políticas exigem `owner_id = auth.uid()` para ler, criar, editar e apagar. Um gatilho impede trocar o dono depois.
- O papel `anon` (quem não fez login) não tem acesso a nenhuma tabela.
- Partilha só acontece em dois lugares, por funções `SECURITY DEFINER` com `search_path` fixo:
  - **listas partilhadas**: só o dono adiciona membros, e só pessoas que já estão num grupo com ele;
  - **grupos**: entrada só por convite. O convite é um token aleatório de 192 bits, guardado só como hash SHA-256, que expira em 7 dias e vale uma vez.
- **Finanças nunca são partilhadas**: as tabelas de renda, gastos, potes, assinaturas e regra não têm nenhuma política de grupo.
- No check-in do grupo, cada pessoa escolhe o que mostrar (nada, só o placar, ou tudo). Ninguém lê a tabela de check-ins dos outros: o grupo só vê pela função `group_scores`, que respeita essa escolha.
- Ao sair de um grupo, a pessoa perde o acesso às listas partilhadas por quem estava nele.
- O câmbio de moedas é digitado por você: o app não chama nenhum serviço de terceiros.
- Colegas de grupo só veem o seu nome (`group_profiles`). E-mail, data de nascimento e fuso não saem do seu perfil.
- Limites de tamanho e formato em todos os campos de texto, valores e datas, para impedir abuso.
- `delete_my_account()` apaga a conta e, em cascata, todos os dados.

**No app**
- Login sem senha: Google (OAuth com PKCE) ou link de uso único por e-mail.
- Nenhum segredo no código. A chave `anon` é pública por design: quem protege os dados são as regras do banco.
- Sem `dangerouslySetInnerHTML` nem HTML vindo do usuário; o React escapa todo o texto.
- O service worker guarda só arquivos estáticos do app. Respostas do Supabase (os seus dados) nunca vão para o cache.
- Fontes servidas pelo próprio app (sem Google Fonts), então nenhum terceiro vê quem abre o app.

**Na hospedagem (`vercel.json`)**
- Content-Security-Policy: só scripts do próprio domínio, conexões só com `*.supabase.co`, sem iframes (`frame-ancestors 'none'`), sem plugins.
- HSTS, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` (câmera, microfone e localização desligados) e `Cross-Origin-Opener-Policy`.

## Testes

`supabase/tests/01_rls_test.sql` roda num Postgres local, com uma imitação do `auth` do Supabase em `00_stub_local_auth.sql`. Ele confirma que:
- ninguém lê tarefas ou gastos de outra pessoa;
- não dá para criar uma linha em nome de outra pessoa nem trocar o dono depois;
- não dá para partilhar uma lista com quem não está no seu grupo;
- um convite não pode ser usado duas vezes;
- quem está fora do grupo não vê o grupo nem o placar;
- o papel `anon` não acessa nada.

`supabase/tests/02_grupo_test.sql` confirma a privacidade do check-in, que convite usado ou falso é recusado e que quem sai do grupo perde as listas partilhadas.

## Conferir antes de usar com outras pessoas

- [ ] Supabase em região da UE.
- [ ] *Confirm email* ligado; *Site URL* e *Redirect URLs* só com os seus domínios.
- [ ] Em **Database → Advisors**, nenhum alerta de segurança.
- [ ] A chave `service_role` não está em nenhum `.env` do app nem na Vercel.
- [ ] (Opcional) Em **Authentication → MFA**, ligar a verificação em dois passos.
- [ ] Rodar `npm audit` antes de cada publicação.

## Encontrou um problema?

Não abra uma issue pública. Fale direto com a dona do projeto.
