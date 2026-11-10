# Beauty v2 — notificações administrativas de pedidos

## Âmbito do MVP

- A criação de um pedido e da respetiva notificação interna ocorre na mesma transação.
- O Admin consulta as notificações por localização, com estado de leitura individual por utilizador.
- O contador de notificações não lidas é independente do número de pedidos pendentes.
- O painel atualiza a cada 12 segundos e quando a janela recupera foco.
- E-mails de novos pedidos e um lembrete de pedido pendente usam uma outbox com leases, retries e chaves de idempotência.
- O envio externo nunca participa na transação que cria o pedido.

## Ativação controlada

1. Aplicar e validar `0027_admin_request_notifications.sql` antes de publicar código que crie pedidos.
2. Manter `STAFF_REQUEST_EMAILS_ENABLED=false` no primeiro deploy.
3. No Admin, por localização, escolher destinatários elegíveis, canais, atraso do lembrete e respeito pelo horário de funcionamento.
4. Confirmar `PUBLIC_URL`, `RESEND_API_KEY` e `RESEND_FROM_EMAIL` sem expor os valores.
5. Fazer um teste com destinatários autorizados e dados fictícios.
6. Só depois definir `STAFF_REQUEST_EMAILS_ENABLED=true` e reiniciar controladamente o serviço.

O worker usa `STAFF_REQUEST_EMAIL_POLL_INTERVAL_MS`, com 10 segundos por omissão. A ativação global sem credenciais Resend válidas falha no arranque. A configuração por localização permanece desligada por omissão.

## Segurança e isolamento

- Feed, leitura e configuração exigem autenticação e capacidades adequadas.
- O worker volta a validar conta ativa, permissão e localização imediatamente antes do envio.
- O e-mail contém apenas um resumo do pedido e uma ligação ao Admin; não inclui tokens públicos de resposta.
- Alterações de configuração e destinatários ficam registadas no audit log.
- Pedidos aprovados, recusados ou com proposta ativa cancelam logicamente o lembrete pendente.

## Limitações conhecidas

- A primeira versão usa polling; não inclui Web Push nem notificações nativas.
- Ativar lembretes não cria retroativamente lembretes para pedidos anteriores.
- A outbox regista aceitação pela Resend, não abertura nem entrega final na caixa de correio.
