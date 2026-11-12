/** Política de privacidade pública (exigida pelo Google para a ligação com a agenda). */
export function Privacidade() {
  return (
    <div className="page" style={{ maxWidth: 720, margin: '0 auto', padding: '40px 20px' }}>
      <span className="mono muted">Dream Board</span>
      <h1 className="h1">Política de privacidade</h1>
      <p className="caption muted">Última atualização: 12 de novembro de 2026</p>

      <h2 className="h3">O que é</h2>
      <p>Dream Board é um app pessoal de planejamento (ciclos de 12 semanas, tarefas, agenda e finanças), usado por um pequeno grupo de pessoas próximas. Não há anúncios, venda de dados nem rastreadores.</p>

      <h2 className="h3">Que dados guardamos</h2>
      <p>O que você cria no app: perfil (nome, fuso, moeda), áreas, metas, passos, tarefas, eventos, hábitos, reflexões e lançamentos financeiros. Os dados ficam no Supabase, em servidores na União Europeia (Irlanda), protegidos por regras de acesso por pessoa: ninguém além de você lê os seus dados. Finanças nunca são partilhadas com o grupo.</p>

      <h2 className="h3">Google Agenda</h2>
      <p>Se você ligar o Google Agenda, o app pede acesso <b>somente de leitura</b> (escopo <code>calendar.readonly</code>) para copiar os seus eventos e a lista das suas agendas para a sua Agenda no app, de 1 mês atrás até 12 meses à frente, e mantê-los atualizados. O app nunca cria, altera ou apaga nada no Google. A chave de acesso fica criptografada no cofre do servidor e só é usada para essa sincronização. O uso das informações recebidas das APIs do Google segue a <a className="link" href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Política de Dados do Usuário dos Serviços de API do Google</a>, incluindo os requisitos de Uso Limitado: os dados não são usados para publicidade, não são vendidos, não são transferidos a terceiros e não são usados para treinar modelos de IA.</p>

      <h2 className="h3">Microsoft To Do</h2>
      <p>Se você ligar o Microsoft To Do, o app lê e escreve as suas listas e tarefas (permissão <code>Tasks.ReadWrite</code>) para mantê-las iguais nos dois lugares, e lê o e-mail da conta (<code>User.Read</code>) só para mostrar qual conta está ligada.</p>

      <h2 className="h3">Seu controle</h2>
      <p>Em Configurações você pode desligar cada ligação (a chave guardada é apagada na hora), exportar todos os seus dados e apagar a sua conta com tudo o que ela tem. Você também pode tirar o acesso pela sua conta Google (myaccount.google.com/permissions) ou Microsoft (account.live.com/consent/Manage).</p>

      <h2 className="h3">Contato</h2>
      <p>Dúvidas sobre privacidade: pelo e-mail de suporte que aparece na tela de permissão do Google.</p>
    </div>
  )
}
