# Beauty v2 — pedidos de marcação sujeitos a aprovação

Estado: Fase 4, motor transacional, proteção pública e interfaces pública/Admin.

## Ativação fail-closed

O workflow só responde quando:

1. `BUSINESS_VERTICAL=beauty`;
2. `BEAUTY_V2_FEATURES_ENABLED=true`;
3. `appointmentRequests=true` para a instalação/localização;
4. para pedidos com mais de um serviço, `multiServiceAppointments=true`.

Todos os defaults permanecem desligados. A migration não cria pedidos,
marcações, settings ou notificações. Barber e Beauty v1 continuam no fluxo
existente enquanto as flags estiverem desligadas.

## Modelo aditivo

`0025_appointment_request_approval.sql` acrescenta:

- `appointment_requests`, com o estado, identidade do cliente e snapshot do
  pedido original;
- `appointment_request_segments`, com a sequência e snapshots imutáveis dos
  serviços, profissionais, preços, durações e buffers pedidos;
- `appointment_request_proposals`, com revisões, expiração, idempotência e
  apenas o hash do token público de resposta;
- `appointment_request_events`, como histórico append-only do workflow;
- ligação opcional do outbox ao pedido, sem alterar os eventos atuais.

Checksum canónico (normalização CRLF → LF do runner):
`30f82cb198db5caf8a713cdc295e40282d9b64d79e63a3f29029a222ff3212a5`.

Pedidos `pending` ou `proposed` nunca criam `appointments` nem períodos de
ocupação. A marcação confirmada só nasce no commit da aprovação ou aceitação.

## Estados e ações

- O cliente cria um pedido simples ou multi-serviço com uma chave de
  idempotência.
- Um utilizador com `appointments.manage_team` pode listar, consultar, aprovar,
  recusar ou propor outro horário apenas na localização selecionada.
- Uma nova proposta substitui a proposta ativa anterior.
- O cliente pode aceitar ou rejeitar através de um token com validade. Só o
  hash do token fica na tabela de propostas; tokens antigos, expirados ou já
  usados não executam novamente a ação.
- Aprovação, recusa, proposta e resposta gravam histórico e audit log na mesma
  transação da mudança de estado.

## Concorrência e compatibilidade

A aprovação reutiliza o motor da Fase 2, incluindo os advisory locks e a
exclusion constraint PostgreSQL. Dentro da mesma transação volta a validar:

- localização, catálogo e atribuições atuais;
- horários da localização e do profissional;
- durações e buffers capturados no pedido;
- todos os períodos ocupados por cada profissional.

Uma concorrência entre aprovação, aceitação e outra reserva tem um único
vencedor. Um conflito não cria uma marcação parcial: o pedido regressa a
`pending`, mantém o histórico e permite recusa ou nova proposta. Retrys de uma
aprovação já concluída devolvem a mesma marcação.

Pedidos de um serviço criam uma marcação legacy normal. Pedidos com vários
serviços criam também o service set e os segmentos da Fase 2. Marcações antigas
não são reinterpretadas ou alteradas pela migration.

## API e interfaces

- `POST /api/appointment-requests`
- `POST /api/appointment-request-proposals/respond`
- `POST /api/appointment-request-proposals/inspect`
- `POST /api/appointment-requests/availability`
- `GET /api/admin/appointment-requests`
- `GET /api/admin/appointment-requests/:id`
- `POST /api/admin/appointment-requests/:id/approve`
- `POST /api/admin/appointment-requests/:id/refuse`
- `POST /api/admin/appointment-requests/:id/propose`
- `POST /api/admin/appointment-requests/:id/proposal-link`
- `POST /api/admin/appointment-requests/:id/proposal-email/resend`

As rotas Admin exigem a capability de gestão de marcações da equipa. A
localização é sempre resolvida pelo middleware existente e não pode ser
fornecida livremente no body.

Os endpoints públicos têm limites independentes por IP/localização, respostas
`no-store` e erros neutros para tokens inexistentes ou obsoletos. O token de
resposta é transportado no fragmento da ligação pública, não no path/query, e
apenas o respetivo SHA-256 é persistido. Repetir uma aceitação já concluída
devolve a mesma marcação sem criar outra.

Com `appointmentRequests=true`, o booking Beauty apresenta o fluxo de pedido e
mantém o fluxo Beauty v1 intacto quando a flag está desligada. Com
`multiServiceAppointments=true`, a cliente pode ordenar até 12 serviços,
escolher o profissional de cada segmento e consultar horários conjuntos antes
de submeter. A disponibilidade apresentada é uma pré-visualização; a aprovação
ou aceitação continua a revalidar tudo dentro da transação.

O Admin disponibiliza uma inbox por localização para pedidos pendentes,
propostas e decisões finais. Aprovação, recusa e proposta continuam protegidas
por `appointments.manage_team` no backend.

## Comunicação das propostas

A migration `0028_appointment_request_proposal_communications.sql` acrescenta
estado de entrega, tentativas, lease e revisão de envio à proposta. O email é
independente das notificações de marcações e fica desligado por omissão através
de `APPOINTMENT_REQUEST_PROPOSAL_EMAILS_ENABLED=false`. A criação da proposta
nunca depende do fornecedor externo: falhas são registadas e repetidas com
backoff, sem anular a decisão do Admin.

Checksum canónico da migration `0028` (normalização CRLF → LF do runner):
`c42c586b2d3565cbc8c2368801e8994b31520ed4503c37481636380f196318f4`.

O token público não é persistido nem incluído no outbox, audit log ou resposta
normal da ação de propor. Só o SHA-256 fica na base de dados. O worker e a ação
explícita «Copiar ligação segura» regeneram o mesmo token de forma determinística
com `SESSION_SECRET`, verificam-no contra o hash e colocam-no apenas no fragmento
`#token=` do URL público. A cópia da ligação e cada reenvio são auditados e
limitados. Rodar `SESSION_SECRET` invalida a regeneração das propostas ativas já
criadas; estas devem ser substituídas por uma nova proposta, nunca recuperadas
através do hash.

O estado `sent` significa apenas que o Resend aceitou a mensagem, não que a
cliente a recebeu ou leu. O Admin distingue proposta registada, email pendente,
retry, falha, email desativado e ausência de endereço. O envio por WhatsApp
continua fora deste MVP e os intents genéricos do outbox mantêm
`DELIVERY_NOT_ENABLED`.

Não estão incluídos nesta fase:

- ativação de flags em qualquer ambiente;
- migrations remotas ou backfill;
- recorrências, alteração de pedidos ou marketing;
- implementação dos outros requisitos Beauty v2.
- entrega de propostas por WhatsApp;
- webhooks de entrega/leitura do email (o estado atual termina na aceitação pelo
  fornecedor).

## Validação

`npm run test:beauty-v2-appointment-requests` cobre flags, pedidos simples e
multi-serviço, idempotência, concorrência, conflitos, rollback, recusa,
propostas aceites/rejeitadas/substituídas/expiradas, localização, histórico,
audit log, outbox desativado e compatibilidade legacy. A migration é validada
por `test:migrations` e `test:database-bootstrap` em PostgreSQL real.

`npm run test:beauty-v2-ui` cobre o booking multi-serviço, a mensagem de pedido
pendente, a resposta protegida a propostas e a inbox Admin em desktop/mobile.
