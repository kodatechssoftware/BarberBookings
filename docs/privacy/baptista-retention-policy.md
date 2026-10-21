# Política operacional de retenção — Baptista Barber Shop

> **Estado: proposta operacional para revisão humana.** Não substitui validação jurídica ou contabilística e não cria, por si só, jobs automáticos.

## Princípios

- conservar apenas o necessário para a finalidade documentada;
- contar o prazo a partir da última interação relevante, expiração ou criação, conforme a categoria;
- preservar dados durante mais tempo apenas quando exista obrigação legal, litígio, investigação ou instrução válida de restrição;
- anonimizar quando o histórico agregado continuar útil sem identificação do titular;
- documentar e testar qualquer futura automação antes de a executar em Production.

## Matriz aprovada/proposta

| Categoria | Prazo operacional | Fundamento técnico | Estado atual e trabalho futuro |
| --- | --- | --- | --- |
| Identidade e contactos associados a marcações | Anonimizar após 24 meses desde a última interação ou marcação | Permite continuidade do atendimento e tratamento de pedidos dentro de uma janela limitada | Sem job automático. Definir rotina futura, regras de anonimização e preservação de integridade financeira |
| Dados financeiros/fiscais legalmente necessários | Apenas durante o período legal aplicável | Os prazos dependem da natureza documental e da obrigação aplicável | **Pendente de validação contabilística/jurídica**; não fixar prazo sem essa validação |
| `baptista:lastBooking` no browser | 30 dias | Conveniência temporária para repetir uma marcação | **Implementado** com timestamp, expiração e limpeza fail-closed de entradas antigas/inválidas |
| Backups operacionais | 14 dias | Recuperação proporcional sem arquivo indefinido | **Implementado no processo operacional externo**; manter testes de restauro e retenção |
| Eventos/payloads técnicos de notificações | 90 dias após conclusão do processamento | Janela suficiente para retries, reconciliação de webhooks, diagnóstico de entrega e reclamações operacionais; depois disso, o valor técnico decresce e permanecem identificadores pessoais | **Tecnicamente razoável e recomendado**. Falta job de purge/anonymização e validação jurídica final |
| Notas internas de cliente | Rever após 12 meses sem interação | Campos livres podem perder atualidade e aumentar o risco de dados excessivos | Sem automação. Criar revisão manual/futura; continuar a proibir dados de saúde/sensíveis |
| Blacklist | Rever pelo menos anualmente | A necessidade de prevenção de abuso pode deixar de existir ou os contactos podem mudar | Sem automação. Rever fundamento, motivo, exatidão e necessidade; remover quando deixar de ser necessário |
| Audit logs | 24 meses desde a criação | Alinha com a janela do histórico identificável e permite investigar incidentes, alterações administrativas e disputas operacionais sem retenção indefinida | **Prazo técnico recomendado**. Falta job de purge/anonymização e validação jurídica final |
| Verification codes | Validade funcional de 10 minutos; eliminar no máximo 24 horas após expiração ou utilização | O código perde utilidade após a expiração; a margem de 24 horas permite diagnóstico operacional limitado sem arquivo desnecessário | Validade de 10 minutos implementada; **limpeza física ainda não implementada** |

## Avaliação dos 90 dias para notificações

Os eventos atuais guardam estados WhatsApp/email, identificadores do fornecedor, timestamps, códigos de erro, referência à marcação e informação técnica usada para idempotência e reconciliação. Estes dados são úteis durante tentativas, webhooks tardios e suporte de entrega. Não existe benefício técnico claro em mantê-los indefinidamente após o processamento estar concluído.

Por isso, 90 dias é uma janela tecnicamente razoável para eventos concluídos. Eventos pendentes, em investigação ou associados a incidente não devem ser eliminados até resolução. O futuro purge deve preservar a integridade das referências e nunca provocar reenvio.

## Justificação dos 24 meses para audit logs

Os audit logs registam ator, ação, entidade, resumo, metadata e data. Um prazo de 24 meses:

- acompanha o período operacional definido para o histórico identificável das marcações;
- suporta investigação de incidentes e alterações administrativas que só sejam detetados mais tarde;
- evita retenção indefinida de nomes de atores e metadata potencialmente pessoal.

Antes da automação deve ser inventariado o conteúdo real de `metadata`, definido o tratamento de eventos sujeitos a investigação e confirmada juridicamente a proporcionalidade do prazo.

## Implementação futura mínima

1. preflight read-only com contagens por categoria e idade;
2. especificação de anonimização de marcações sem quebrar histórico financeiro ou integridade referencial;
3. purge transacional e idempotente de verification codes e dados técnicos vencidos;
4. revisão manual assistida de notas e blacklist;
5. exceções documentadas para obrigação legal, litígio, incidente ou restrição;
6. dry-run, relatório de impacto, backup verificável e rollout controlado antes de Production.
