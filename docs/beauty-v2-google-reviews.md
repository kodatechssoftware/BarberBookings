# Beauty v2 — avaliações Google

## Fase 1: ligações oficiais, sem custos

A implementação atual não comunica com a Google Places API, não necessita de
chave, projeto Google Cloud ou faturação e não guarda classificações, contagens
ou textos de avaliações.

Por localização, guarda apenas:

- `google_place_id`, opcional e reservado para uma integração futura;
- uma ligação HTTPS completa de `google.com/maps` para consultar avaliações;
- uma ligação oficial para escrever uma avaliação (`search.google.com/local/writereview`
  ou o formato exato `g.page/r/.../review`).

O site recebe um DTO público por lista positiva de campos. O `google_place_id`
não é devolvido como configuração pública. Ligações encurtadas e domínios que
apenas se parecem com os domínios Google são rejeitados, porque a aplicação não
segue redirecionamentos para validar o destino.

## Fase futura: Places API (não implementada)

Qualquer implementação futura exige uma nova aprovação funcional e de custos.

### Pedido mínimo previsto

Usar Place Details (New) no servidor, pelo Place ID configurado, com uma field
mask explícita. Para mostrar classificação, contagem, ligação oficial e até
cinco avaliações, a máscara prevista é:

`id,displayName,rating,userRatingCount,googleMapsUri,reviews`

Se apenas forem necessários classificação e total, omitir `reviews` reduz os
campos pedidos e pode alterar o SKU faturado. A documentação oficial indica que
pedir `reviews` usa o nível Place Details Enterprise + Atmosphere e devolve até
cinco avaliações.

Referência: <https://developers.google.com/maps/documentation/places/web-service/place-details>

### Faturação, quotas e chave

- A Places API usa faturação pay-as-you-go por SKU; preços, limites gratuitos e
  descontos devem ser confirmados na data de ativação.
- Definir quotas conservadoras, alertas/orçamentos e um limite de custo antes de
  ligar a funcionalidade.
- A chave fica apenas no ambiente do servidor, nunca na base de dados, bundle do
  browser, respostas ou logs.
- Restringir a chave à Places API e, quando suportado pelo tipo de credencial,
  restringir também a origem/identidade do serviço. Usar chaves separadas por
  ambiente e processo de rotação.

Referência: <https://developers.google.com/maps/documentation/places/web-service/usage-and-billing>

### Atribuição e apresentação

Ao apresentar Places API sem um mapa Google, cumprir a atribuição Google e as
regras de apresentação. Para avaliações, apresentar também a atribuição do
autor e as ligações disponibilizadas pela API. Não inventar, editar, fundir ou
reordenar conteúdo de forma que altere o seu significado.

Referências:

- <https://developers.google.com/maps/documentation/places/web-service/policies>
- <https://developers.google.com/maps/documentation/places/web-service/reference/rest/v1/places>

### Armazenamento e cache

Não existe cache de conteúdo Places nesta fase. A política oficial proíbe, em
geral, pré-obter, guardar ou redistribuir conteúdo Places fora das exceções
expressas; Place IDs podem ser guardados. Antes de implementar qualquer cache,
é obrigatório voltar a confirmar os termos aplicáveis, incluindo condições
regionais para o EEE, e documentar exatamente a exceção e o tempo permitido.

Não assumir um cache de seis horas para avaliações sem essa confirmação.

### Falhas e fallback

Uma futura falha, quota esgotada ou configuração incompleta nunca deve bloquear
a homepage. A secção recua para as ligações oficiais já guardadas. Respostas da
API são validadas por allowlist e não são substituídas por classificações ou
testemunhos fictícios.

## Critérios antes da fase Places

1. Aprovação explícita de faturação e teto mensal.
2. Revisão atual dos preços, termos, políticas de cache e requisitos do EEE.
3. Projeto Cloud e chave separados por ambiente, com restrições e quotas.
4. Consentimento sobre a apresentação pública e atribuição visual.
5. Testes de indisponibilidade, quota, resposta inválida e fallback.
6. Auditoria para garantir que chaves e conteúdo de terceiros não são persistidos
   em locais não autorizados.
