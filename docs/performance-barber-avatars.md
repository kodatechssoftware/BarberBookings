# Performance: catálogo de barbeiros e fotografias (2026-09-21)

## Âmbito e diagnóstico

Continuação da auditoria iniciada em 2026-09-17, sem repetir as medições remotas
já recolhidas. Base development: `240d3c7`. Sem deploy, alterações de infraestrutura,
dados remotos, migrations, pool, horários, booking ou notificações.

A resposta pública previamente medida em Production tinha 807 046 bytes de JSON,
dos quais 806 658 eram fotografias. São data URLs em `barbers.avatar` (coluna TEXT).
O upload administrativo já reduz as imagens e guarda JPEG, até 900 KiB por imagem.
O `loading="lazy"` existente na Home não evita transportar uma data URL no JSON.
A Agenda precisa do catálogo, mas não das fotografias no seu carregamento inicial.

Isto identifica um desperdício concreto em `/api/barbers`, não a causa única da
latência da Home. Serviços e horário já correm em paralelo depois de carregar o
JS principal e o módulo Home; o React apresenta os serviços poucos ms após a API.

## Alteração compatível, sem migração

- `GET /api/barbers?avatarMode=reference` é opt-in. Sem o parâmetro, a resposta
  antiga mantém as imagens embutidas, para compatibilidade com clientes antigos.
- O frontend utiliza o modo leve. PostgreSQL projeta uma URL em vez do conteúdo
  da fotografia; os outros utilizadores de `getBarbers()` não mudam.
- `GET /api/barbers/:id/avatar?v=<content-version>&locationId=<id>` devolve os
  bytes originais de PNG/JPEG/WebP/GIF, sem resize, recompressão ou alteração na BD.
- A versão MD5 só identifica o conteúdo, não constitui autenticação. O parâmetro
  de loja passa pelas mesmas verificações de acesso do middleware; a rota verifica
  ainda associação à loja, visibilidade e sessão Admin/próprio barbeiro.
- `Cache-Control: no-store` mantém a política existente da API. Não foi introduzida
  cache para esconder latência nem cache pública de fotografias ocultas.
- URLs externas/locais e valores nulos mantêm o comportamento anterior.
- O editor omite `avatar` quando a foto não foi editada. O backend ignora a
  referência de leitura do próprio barbeiro recebida num PATCH, incluindo versões
  antigas, e rejeita referências de outro barbeiro. A imagem guardada não pode ser
  substituída acidentalmente por uma URL de leitura.
- Home, Booking e Equipa continuam a usar o mesmo `src` e CSS. O lazy loading
  existente da Home passa a poder adiar também os bytes; o limiar é do browser.

## Antes/depois medido

### PostgreSQL local, efémero

Teste real da projeção SQL com dois uploads sintéticos de tamanho semelhante ao
observado em Production, um avatar nulo e uma URL local. Dados originais preservados.

| Métrica | Antes | Depois |
| --- | ---: | ---: |
| JSON dos registos devolvidos pela storage | 807 211 B | 661 B |
| Queries para a leitura do catálogo | 1 | 1 |
| Mediana de 6 leituras locais, incluindo round trip | 2,29 ms | 3,68 ms |

Redução de payload: **99,918%**. Não houve redução do número de queries. O cálculo
da versão da imagem acrescenta trabalho SQL (~1,4 ms neste ensaio local), em troca
de não transmitir as fotos PostgreSQL → Node em cada leitura do catálogo. Não é
uma medição do custo de execução SQL em Render.

### Browser: build de release e backend local isolado

Chromium headless, viewport 390×844, DPR 3, CPU 4× mais lenta, rede emulada
(80 ms, download 1,5 MB/s), backend em memória. Duas imagens JPEG sintéticas
iguais às usadas em ambas as variantes, total de JSON antigo 806 857 B.
Terceiros e service worker excluídos **nas duas variantes** para isolar o transporte.
O mesmo build solicita a representação antiga ou a nova; não muda o layout.
Ordem alternada entre variantes. Três contextos novos e um reload por contexto.

"Cold" abaixo significa cache de browser fria, **não** cold start do Render/BD.
O backend local tem TTFB de poucos ms; não reproduz a topologia de Production.

| Cenário | Equipa no DOM antes (ms) | Depois (ms) | API barbers antes (ms) | Depois (ms) |
| --- | ---: | ---: | ---: | ---: |
| Cold 1 | 1882 | 1250 | 833 | 187 |
| Cold 2 | 1878 | 1254 | 839 | 187 |
| Cold 3 | 1873 | 1279 | 826 | 181 |
| Reload 1 | 1688 | 1024 | 776 | 103 |
| Reload 2 | 1715 | 1027 | 751 | 105 |
| Reload 3 | 1722 | 1068 | 764 | 103 |

Medianas: equipa **1878 → 1254 ms (-33,2%)** no cold e **1715 → 1027 ms
(-40,1%)** no reload. Duração da API **833 → 187 ms (-77,6%)** e
**764 → 103 ms (-86,5%)**, respetivamente. JSON HTTP **806 857 → 613 B**.
Estes ganhos são do ensaio, não uma promessa dos mesmos percentuais em Render.
"Equipa no DOM" mede os cartões, não a conclusão de todas as fotografias lazy.

Serviços: medianas cold 1247 → 1254 ms; reload 1056 → 1027 ms.
Horário: cold 1268 → 1254 ms; reload 1060 → 1053 ms.
**Sem ganho relevante demonstrado nestes dois recursos.** Início de barbers:
~1016 → 1003 ms cold, ~939 → 907 ms reload; a cadeia JS/mount não foi otimizada.

Chamadas diretas locais: ~4–7 ms antes, ~2–4 ms depois. JSON.parse isolado em Node:
~0,36–0,58 ms antes e ~0,009–0,013 ms depois. Isto não atribui o atraso remoto a
parsing; a transferência é o ganho principal demonstrado.

### Mobile: profiling, não suposições

Tracing CDP com long tasks, JS, layout, paint, raster/decode, composição e commits
React. Scroll de 6 s pelas secções topo/serviços/equipa/morada em cada uma das 12
cargas. Não houve frames >34 ms durante esse scroll controlado em nenhuma variante.

- Cold: existiram 1–2 long tasks antes e 2 depois (a segunda, após a mudança,
  ~54–56 ms). Não houve long tasks nos reloads. Não alegamos eliminação de jank.
- Primeiro layout: máximo ~66–74 ms, dentro de trabalho inicial do bundle principal,
  semelhante nas duas versões; não atribuído a blur/navbar.
- ImageDecodeTask agregado cold: ~23–24 ms antes, ~28–30 ms depois, executado em
  workers, com máximos ~9–11 ms. Mesmos pixels continuam a exigir decodificação;
  URLs separadas não são thumbnails e não garantem menor CPU de decode.
- Paint agregado ~10–14 ms; composição observada não mostrou um gargalo neste ensaio.
- Foram observados 24–26 commits React por carga; não é duração de profiler React.
  Tempos inclusivos/nested do trace não devem ser somados como tempo total de CPU.
- O heap exposto pelo browser estava arredondado; não serve para quantificar ganho
  real de memória. A representação JSON e as suas cópias temporárias ficam menores,
  mas a memória da imagem descodificada não muda.

As pausas anteriormente observadas em mobile real/remoto não foram reproduzidas
neste isolamento. Terceiros estavam excluídos e headless não reproduz GPU/iOS.
Não há prova suficiente para culpar as fotos, o mapa, o navbar ou o service worker.

## Pool, SQL e restante atraso

Preservados os logs DEV previamente recolhidos com pool=4:

- rajada inicial: espera acumulada por rota de ~330–530 ms em várias rotas;
  pedidos seguintes perto de zero;
- services: 5 queries, ~416–420 ms de round trips acumulados, ~507–824 ms de
  duração; barbers: 10 queries, ~1078–1157 ms acumulados, ~749–1084 ms de duração;
- competem sessões, seleção de loja, catálogos/associações/regras financeiras,
  appointments e restantes leituras Admin. Existe um pool singleton, não um pool
  novo por request.

**Não é possível decompor estes valores numa percentagem exata pool/SQL/payload.**
As queries paralelas somam tempos sobrepostos; os round trips incluem rede e
descodificação do driver, não só execução PostgreSQL. Os tempos de middleware
também incluem essas queries e não podem ser adicionados de novo.
Além disso, a classificação idle/queued é obtida antes de `pool.connect`: em
aquisições simultâneas, parte da espera pode aparecer em acquireIdleMs. Convém
avaliar acquireMs e fila, não apenas acquireQueuedMs.

As medições públicas remotas anteriores de barbers foram TTFB ~0,70–1,45 s e
total ~0,86–1,83 s. A fotografia não explica todo esse TTFB. Não foi feita nova
medição remota nem deploy desta mudança. Não há evidência de índice em falta para
esta leitura de poucos barbeiros ordenada pela PK; o problema confirmado é volume.

Aumentar 4 → 6/8 pode reduzir fila durante a rajada se houver capacidade da BD,
mas não reduz RTT, número de queries ou o arranque do frontend. Sem medir a carga
com esta redução de payload não há justificação para o aumento. Pool inalterado.

## Startup / Application loading

`server/index.ts` chama e aguarda `repairKnownTextEncodingArtifacts()` depois dos
ensure* e antes de `registerRoutes`, configuração do servidor e `listen`.
Em `server/db.ts`, a rotina faz BEGIN, 7 colunas × 16 substituições = 112 UPDATEs,
e COMMIT, em **cada arranque que usa PostgreSQL**, mesmo sem linhas a corrigir.
O pool é adquirido uma vez durante esta transação.

O ensaio local anterior mediu ~15–24 ms com 1000 appointments e 1000 audit logs.
Isto não estima o custo de 114 round trips numa BD remota. Não temos nesta fase
timing isolado da rotina em Render nem correlação temporal com o incidente
"Application loading". O texto não existe no frontend; não basta para concluir
que esta rotina ou qualquer plataforma foi a causa.

A rotina é reparação de dados, não cálculo de disponibilidade. Potenciais opções
futuras: operação one-time registada/explicitamente executada, predeploy ou redução
dos round trips preservando a ordem das substituições. Antes de retirar do startup,
é necessário comprovar que não há dados a reparar nem escritores a reintroduzir
o problema. Mover simplesmente para background altera a garantia de dados
reparados antes de servir pedidos. **Não foi movida, removida ou modificada.**

## Ranking e próximos passos

- **P0 implementado:** catálogo com referências, sem fotos no JSON inicial da
  Agenda; maior desperdício de bytes comprovado, compatibilidade preservada.
- **P1:** após deploy DEV autorizado, medir novamente fila/round trips de catálogo
  com uploads representativos; recolher timing real por fase do startup e perfil
  mobile físico com terceiros; investigar a cadeia index JS → Home → APIs.
- **P2:** avaliar thumbnails/caching autenticado ou um pool maior apenas com nova
  evidência. Não há fundamento para alterar blur/navbar ou service worker agora.

Risco residual: duas imagens usadas implicam dois GETs adicionais, sujeitos a
sessão/loja e leitura de BD. No-store privilegia permissões atuais, não caching;
não se reduziu o número global de queries. No cold completo, os bytes binários das
imagens continuam a ser transferidos quando necessárias. A redução de JSON não é
equivalente à poupança no fio com Brotli, nem resolve o startup remoto.

## Validação

- TypeScript e build completo: PASS.
- Notifications/outbox/webhook/inbound: 56/56; Production runtime: 7/7.
- Availability/DST unitários: 7/7; catálogo PostgreSQL + timings: 5/5.
- Multi-location: 4/4, incluindo fotos/lojas e conflito global.
- Admin/Home/serviços/layout/fotografias: 14/14; restantes horários/booking/admin
  focados validados, incluindo concorrência 2 e 5 (1 criação + conflitos 409).
- Total de cenários E2E distintos validados em lotes: 47 (42 focados, 4
  multi-location, 1 production-equivalent), contando o teste de loading após
  ajustar o matcher. Booking smoke foi focado, não a bateria integral.
- Production-equivalent smoke local: 1/1.
- Um teste de loading inicialmente não intercetava o novo query parameter.
  Foram ajustados os dois matchers de URL existentes, preservando as mesmas
  assertions; o teste voltou a passar. Não foi alterada lógica para mascarar falhas.
- `git diff --check`: PASS.

Testes novos verificam bytes/MIME originais, versão após substituir a imagem,
remoção, edição com referência antiga sem perder a foto, compatibilidade legacy,
sem exposição de campos privados, ocultação, associação à loja, ausência de GET
de fotos na Agenda e imagens utilizáveis na Home/mobile/Booking/Admin.

## Ficheiros da alteração

- `server/barber-avatars.ts`: referências versionadas e leitura dos bytes.
- `server/storage.ts`: projeção leve opt-in, PostgreSQL e memory storage.
- `server/routes.ts`: catálogo opt-in, endpoint de imagem, acesso e proteção do PATCH.
- `client/src/hooks/use-barbers.ts`: pedido leve e resolução do URL da API.
- `client/src/pages/Admin.tsx`: não reenviar a foto quando não foi editada.
- `tests/e2e/barber-avatars.spec.ts`: transporte, edição e utilização das imagens.
- `tests/e2e/multi-location.spec.ts`: fotos com contexto/permissões por loja.
- `tests/e2e/booking-smoke.spec.ts`: matchers compatíveis com o novo parâmetro.
- `tests/unit/location-catalogue-reads.test.ts`: projeção PostgreSQL e bytes/timings.
- `docs/performance-barber-avatars.md`: diagnóstico, medições e limitações.
