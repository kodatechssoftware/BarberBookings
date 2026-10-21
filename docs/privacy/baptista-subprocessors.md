# Registo de subprocessadores — Baptista Production

> **Estado: auditoria técnica/documental de 21 de outubro de 2026.** A disponibilidade pública de um DPA não prova que a versão aplicável tenha sido aceite na conta concreta. Regiões não demonstráveis por configuração ou documentação foram mantidas como não verificadas.

## Resumo

| Serviço | Função e dados | Região verificada | DPA/termos | Transferência internacional e pendentes |
| --- | --- | --- | --- | --- |
| Supabase | PostgreSQL: clientes, marcações, contactos, pagamentos operacionais, notas, blacklist, auditoria e notificações | **West EU (Ireland), `eu-west-1`**, inferido do endpoint Production já auditado e confirmado pela nomenclatura oficial Supabase | DPA público disponível; prevê processamento primário na região escolhida e SCC quando aplicável | O core está na região escolhida, mas a documentação admite categorias limitadas de processamento fora dela. Confirmar entidade contratual, versão do DPA e subprocessadores da conta |
| Render | Alojamento/execução da aplicação; pedidos HTTP, dados transitórios, logs técnicos e secrets de configuração | **Não verificada para o serviço Production.** Frankfurt é uma região disponível, mas não deve ser presumida | DPA público disponível, com SCC e lista de subprocessadores | Confirmar no dashboard a região do serviço, a entidade contratual, o DPA aplicável e os subprocessadores ativos |
| Meta / WhatsApp | Telefone, nome e conteúdo transacional mínimo da marcação; template, identificador e estado de entrega | Serviço global; os termos referem EEE e EUA. Localização concreta do processamento **não verificada** | WhatsApp Business Data Processing Terms e adendas de transferência disponíveis | Transferências internacionais potenciais. Confirmar entidade contratual da conta Business, adenda aplicável e subprocessadores |
| Resend | Email, nome/conteúdo da mensagem transacional, identificadores e estados de entrega | **Não verificada para a conta.** A lista pública inclui vários subprocessadores nos EUA | DPA público disponível; inclui SCC e mecanismos de transferência | Transferências internacionais potenciais. Confirmar DPA aceite, tracking ativo/inativo, subprocessadores e configuração da conta |
| Cloudflare / R2 | Serviços de rede e backups cifrados/objetos que podem conter a totalidade dos dados da aplicação, mais metadata/checksum | Jurisdição do bucket **não verificada**. R2 pode usar localização automática ou restrição jurisdicional EU/US | DPA público disponível | Confirmar se o bucket usa jurisdição `eu`, localização automática ou hint; confirmar DPA, subprocessadores e mecanismos aplicáveis |

## Fontes oficiais consultadas

- Supabase regions: https://supabase.com/docs/guides/platform/regions
- Supabase data residency/transfers: https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq
- Supabase DPA: https://supabase.com/legal/customer-resources/data-processing-addendum
- Render regions: https://render.com/docs/regions
- Render DPA: https://render.com/dpa
- WhatsApp Business Data Processing Terms: https://www.whatsapp.com/legal/business-data-processing-terms
- Resend DPA: https://resend.com/legal/dpa
- Resend subprocessors: https://resend.com/legal/subprocessors
- Cloudflare DPA: https://www.cloudflare.com/cloudflare-customer-dpa/
- Cloudflare R2 data location: https://developers.cloudflare.com/r2/reference/data-location/

## Validações contratuais ainda necessárias

1. identificar a entidade e a versão contratual efetivamente aceite em cada conta;
2. arquivar os DPA/termos aplicáveis e definir responsável pela revisão de atualizações;
3. confirmar regiões no dashboard de Render e Cloudflare R2;
4. confirmar mecanismos de transferência, SCC/adendas e eventual avaliação de impacto;
5. rever as listas de subprocessadores de cada fornecedor;
6. refletir alterações relevantes no DPA Baptista–KodaTechs e na política pública.
