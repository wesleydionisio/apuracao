// Política de privacidade e termos de uso (links da tela de consentimento do Google).
// Texto-base: revisar com quem responde juridicamente pelo site antes do lançamento.
import type { ReactNode } from 'react';
import { Link } from 'wouter';

const CONTACT = 'wesley.r.dionisio@gmail.com';
const UPDATED = '24 de outubro de 2026';

function Doc({ title, children }: { title: string; children: ReactNode }) {
  return (
    <article className="mx-auto max-w-2xl py-6 text-[14.5px] leading-relaxed text-foreground/90 [&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-[16px] [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mt-1 [&_p]:mt-3 [&_ul]:mt-2 [&_ul]:list-disc [&_ul]:pl-5">
      <h1 className="text-[24px] font-bold tracking-tight text-foreground">{title}</h1>
      <p className="!mt-1 text-[12.5px] text-muted-foreground">Urna Digital · atualizado em {UPDATED}</p>
      {children}
      <p className="!mt-8 text-[13px] text-muted-foreground">
        Dúvidas ou pedidos: <a href={`mailto:${CONTACT}`} className="underline underline-offset-4">{CONTACT}</a>.{' '}
        <Link href="/" className="underline underline-offset-4">
          Voltar ao placar
        </Link>
      </p>
    </article>
  );
}

export function PrivacyPage() {
  return (
    <Doc title="Política de privacidade">
      <p>
        A Urna Digital (urnadigital.online) mostra a apuração do 2º turno com dados públicos do TSE e tem um chat ao vivo.
        Esta política explica quais dados pessoais tratamos, por quê e quais são os seus direitos (Lei 13.709/2018, LGPD).
      </p>
      <h2>O que coletamos</h2>
      <ul>
        <li>
          <strong>Sem conta:</strong> um identificador anônimo em cookie, o lado da torcida escolhido (guardado no seu aparelho) e o
          endereço IP, usado só para limitar abuso.
        </li>
        <li>
          <strong>Ao entrar com o Google:</strong> recebemos do Google seu e-mail, nome e um identificador da conta. Não recebemos
          sua senha nem acesso a outros dados ou serviços do Google.
        </li>
        <li>
          <strong>No cadastro:</strong> nome, celular e o nome de usuário que você escolher.
        </li>
        <li>
          <strong>No chat:</strong> as mensagens que você envia, as reações e as denúncias.
        </li>
        <li>
          <strong>No palpite:</strong> o apelido e os números que você informar.
        </li>
        <li>
          <strong>No Super Chat:</strong> a mensagem, o valor e a situação do pagamento. O Pix é processado pelo seu banco e,
          quando usado, pelo Mercado Pago; não recebemos dados do seu cartão nem da sua conta bancária. O e-mail da conta é
          informado ao Mercado Pago como identificação de quem paga.
        </li>
      </ul>
      <h2>Para que usamos</h2>
      <ul>
        <li>Identificar quem escreve no chat e manter a conversa segura (moderação, limite de mensagens, bloqueio de abuso).</li>
        <li>Entrar em contato sobre a sua conta ou sobre uma denúncia, se necessário.</li>
        <li>Confirmar pagamentos de Super Chat e manter os registros exigidos por lei.</li>
        <li>Cumprir obrigações legais e atender pedidos de autoridades competentes.</li>
      </ul>
      <p>
        A base legal é a execução do serviço que você pediu (participar do chat) e o legítimo interesse em prevenir abuso. Não
        vendemos dados nem os usamos para publicidade.
      </p>
      <h2>O que fica público</h2>
      <p>
        No chat aparecem só o seu nome de usuário, a cor do avatar, o número do lado da torcida e as suas mensagens. Nome, e-mail
        e celular nunca são exibidos.
      </p>
      <h2>Moderação</h2>
      <p>
        As mensagens passam por um filtro automático e podem ser analisadas por um serviço de classificação de conteúdo
        (OpenRouter) apenas para decidir se violam as regras do chat.
      </p>
      <h2>Por quanto tempo</h2>
      <p>
        Mensagens do chat ficam guardadas por até 90 dias após a eleição. Os dados da conta ficam até você pedir a exclusão, ou
        por até 12 meses sem uso. Registros de acesso podem ser guardados por 6 meses, como pede o Marco Civil da Internet.
      </p>
      <h2>Seus direitos</h2>
      <p>
        Você pode pedir acesso, correção, portabilidade ou exclusão dos seus dados, e revogar o consentimento, escrevendo para o
        e-mail abaixo. Também pode remover o acesso da Urna Digital à sua conta em myaccount.google.com/permissions.
      </p>
      <h2>Cookies</h2>
      <p>
        Usamos só cookies necessários: o identificador anônimo (palpite e chat) e a sessão de quem entrou. No aparelho também
        ficam preferências como o tema, o lado da torcida e o aviso de cookies já lido. Não usamos cookies de publicidade nem de
        rastreamento. O login com o Google pode gravar cookies do próprio Google, regidos pela política dele.
      </p>
      <h2>Publicidade</h2>
      <p>
        A faixa de patrocínio no topo é um link simples: não compartilhamos dados com anunciantes. Ao tocar nela você vai para o
        site do patrocinador ou para o nosso WhatsApp, que têm as próprias políticas.
      </p>
    </Doc>
  );
}

export function TermsPage() {
  return (
    <Doc title="Termos de uso">
      <p>Ao usar a Urna Digital você concorda com estes termos.</p>
      <h2>O serviço</h2>
      <p>
        Projeto independente, sem vínculo com o TSE, partidos ou candidatos. Os números vêm do TSE; projeções são estimativas e o
        resultado oficial é o da totalização do TSE. A torcida do chat e os palpites não são voto nem pesquisa eleitoral.
      </p>
      <h2>Conta</h2>
      <p>
        Para mandar mensagens é preciso entrar com o Google e informar nome, celular e nome de usuário verdadeiros. A conta é
        pessoal. O nome de usuário não pode imitar outra pessoa, candidato ou instituição.
      </p>
      <h2>Regras do chat</h2>
      <ul>
        <li>Sem links, ofensas, ameaças, discriminação, conteúdo sexual ou spam.</li>
        <li>Sem desinformação sobre o processo eleitoral.</li>
        <li>Mensagens de até 240 caracteres.</li>
      </ul>
      <p>
        Mensagens que violam as regras podem ser bloqueadas automaticamente ou removidas após denúncias, e a conta pode ser
        silenciada ou suspensa. Você responde pelo que escreve.
      </p>
      <h2>Super Chat</h2>
      <p>
        O Super Chat é uma mensagem destacada no chat, paga com Pix. Ela passa pela mesma moderação do chat antes do Pix ser
        gerado e segue as mesmas regras. Um Super Chat que viole as regras pode ser removido. O pagamento é um apoio ao projeto,
        não compra de voto, de posição política ou de espaço editorial.
      </p>
      <h2>Disponibilidade</h2>
      <p>
        O serviço é oferecido como está, sem garantia de funcionamento contínuo. O chat pode ser pausado a qualquer momento,
        por exemplo por moderação ou pico de acesso.
      </p>
      <h2>Mudanças</h2>
      <p>
        Estes termos podem mudar; a data no topo mostra a versão em vigor. Veja também a{' '}
        <Link href="/privacidade" className="underline underline-offset-4">
          política de privacidade
        </Link>
        .
      </p>
    </Doc>
  );
}
