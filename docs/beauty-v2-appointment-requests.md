# Beauty v2 — pedidos de marcação sujeitos a aprovação

Estado: Fase 3, contratos, API e motor transacional. A interface final pública
e Admin continua fora de âmbito.

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

## API preparada nesta fase

- `POST /api/appointment-requests`
- `POST /api/appointment-request-proposals/respond`
- `GET /api/admin/appointment-requests`
- `GET /api/admin/appointment-requests/:id`
- `POST /api/admin/appointment-requests/:id/approve`
- `POST /api/admin/appointment-requests/:id/refuse`
- `POST /api/admin/appointment-requests/:id/propose`

As rotas Admin exigem a capability de gestão de marcações da equipa. A
localização é sempre resolvida pelo middleware existente e não pode ser
fornecida livremente no body.

## Notificações e limites intencionais

Os intents de pedido/proposta são registados no outbox existente com chaves
determinísticas, mas ficam concluídos como `DELIVERY_NOT_ENABLED`: esta fase não
envia WhatsApp nem email reais. O payload fica preparado para uma integração
posterior e os eventos normais de confirmação só seguem a configuração já
existente depois de existir uma marcação confirmada.

Não estão incluídos nesta fase:

- UI pública ou Admin definitiva;
- ativação de flags em qualquer ambiente;
- migrations remotas ou backfill;
- recorrências, alteração de pedidos ou marketing;
- implementação dos outros requisitos Beauty v2.

## Validação

`npm run test:beauty-v2-appointment-requests` cobre flags, pedidos simples e
multi-serviço, idempotência, concorrência, conflitos, rollback, recusa,
propostas aceites/rejeitadas/substituídas/expiradas, localização, histórico,
audit log, outbox desativado e compatibilidade legacy. A migration é validada
por `test:migrations` e `test:database-bootstrap` em PostgreSQL real.
