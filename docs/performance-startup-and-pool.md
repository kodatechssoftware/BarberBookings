# Diagnóstico de startup e pool — apenas DEV

## Estado e limites

Esta alteração adiciona observabilidade, não uma otimização funcional. Preserva
as otimizações de avatars e da Home, a ordem do startup, as queries, sessões,
workers, flags e a configuração do pool. Não inclui migrations nem deploy.

Os primeiros logs DEV mostravam aproximadamente 17 s entre `starting
BarberBookings API` e `serving`. A recolha posterior em DEV Render Free
identificou ~9,55 s no repair e ~4,18 s no demo-sync num startup de ~20 s.
Não extrapolar estes tempos para Production pago; demo-sync não faz parte
do startup não-demo. Os 15–24 ms medidos anteriormente em PostgreSQL local
também não estimam o custo remoto. A otimização posterior, limitada ao repair,
está descrita em [equivalência e medições](text-encoding-repair-equivalence.md).

## Ativação e formato

Usa exclusivamente as variáveis existentes:

```ini
APP_ENV=development
PERFORMANCE_TIMINGS_ENABLED=true
DATABASE_POOL_MAX=4
```

`PERFORMANCE_TIMINGS_ENABLED` continua false por defeito; `APP_ENV=production`
não produz estes diagnósticos mesmo com a flag true. Um build com
`NODE_ENV=production` em DEV pode produzir logs; não mudar NODE_ENV para medir.

Cada linha `[startup]` contém `phase`, `status`, `at` (UTC), `startMs`,
`elapsedMs`, `durationMs` e, quando aplicável, `parent` e métricas SQL/pool.
Os nomes das fases são fixos. Não são registados SQL, parâmetros, resultados,
mensagens de erro, credenciais, URLs ou dados de clientes nestas linhas.
Falhas do logger não substituem erros da aplicação.

| Fase | O que mede |
| --- | --- |
| `process-origin` | Origem retrospectiva do relógio Node; não é uma linha emitida antes dos imports |
| `instrumentation-ready`, `entry-module-ready` | Marcos de inicialização do logger e conclusão dos imports do entrypoint |
| `db-pool-configuration` | Construção do pool/Drizzle; não abre antecipadamente uma ligação |
| `http-configuration`, `runtime-validation` | Configuração inicial HTTP e validação existente |
| Cada `ensure*` | Cada uma das seis rotinas existentes de schema/compatibilidade no entrypoint, individualmente |
| `repairKnownTextEncodingArtifacts` | Rotina existente completa, incluindo transação e UPDATEs; não foi movida ou removida |
| `registerRoutes` | Sessões, registo de rotas e seed, inclusivamente |
| `session-store-initialization`, `ensureSessionStoreTable` | Construção das sessões e preparação da tabela existente, separadamente |
| `seedDatabase`, `seed.hasData`, `seed.admin-read`, `seed.demo-sync`, `ensureDefaultShopAvailability` | Seed total e subfases que efetivamente executarem nesse ambiente |
| `workers` | Agendamento do worker; `skipped` se desligado. Não aguarda o primeiro tick nem os seguintes |
| `http-final-configuration` | Handlers finais HTTP |
| `static-setup` ou `vite-setup` | Setup correspondente ao NODE_ENV, sem trocar o modo servido |
| `total-before-listen` | Tempo desde a origem Node até imediatamente antes da chamada listen, incluindo imports |
| `http-listen` | Chamada listen até ao callback de escuta |
| `starting-to-listen` | Intervalo comparável ao antigo par de logs starting/serving |
| `listening` | Marco final após abertura da porta |

Não somar pais e filhos: o tempo de parede do pai inclui os filhos. As métricas
SQL pertencem à fase mais interna que executou a query, não são somadas
automaticamente ao pai. O primeiro estabelecimento real de ligação aparece
na aquisição da primeira fase SQL, não na construção preguiçosa do pool.
Timers criados dentro de uma fase não continuam a contabilizar startup após
o fecho dessa fase. Operações aguardadas preservam resultados e erros.

`sqlRoundTripMs` mede o round-trip visto pelo processo, não execução pura no
PostgreSQL: inclui rede, protocolo e processamento do driver. `acquireMs` mede
aquisição; `acquireNewMs`/`acquireQueuedMs` classificam pelo estado do pool no
início da aquisição. São métricas agregadas e podem sobrepor-se em paralelismo;
não subtrair cegamente os agregados ao tempo total nem convertê-los em percentagem
exclusiva de latência. Sem tracing no servidor SQL, não é possível separar
exatamente CPU SQL e rede.

Para correlacionar `Application loading`, usar timestamps de arranque/listen,
readiness e da navegação que encontrou essa página. A mensagem isolada não
prova que a reparação, o pool ou o Render foram a causa. Nenhuma rotina deve
ser movida para predeploy/job/migration apenas com base no intervalo de 17 s.

## Rajada inicial da Agenda: auditoria, não alterações

Fontes: `client/src/pages/Admin.tsx`, `server/routes.ts`, `server/storage.ts`.
Contagens abaixo descrevem Admin autenticado, sessão existente e multi-location
ativo: geralmente duas operações de sessão (get/touch) e uma leitura do
middleware de localização. Não são constantes para pedidos anónimos, outras
roles ou flags diferentes. O log `[perf].sqlCount` confirma cada amostra real.

| Rota/dataset | Queries típicas | Composição e prioridade |
| --- | ---: | --- |
| `/api/barbers` | 10 | 7 handler + 3 comuns: catálogo, serviços associados, regras financeiras, barbeiros atribuídos à loja, serviços da loja, barbeiros ativos na loja, contagem de lojas em lote. Essencial para Agenda |
| `/api/admin/dashboard` | 8 | 5 handler + 3 comuns: appointments, barbeiros, serviços e duas listas de associações por loja. Já espera os dados iniciais da Agenda |
| `/api/services` | 5 | Catálogo + associações à loja + 3 comuns. Essencial para Agenda |
| `/api/appointments` | 4 por pedido | Uma leitura de appointments + 3 comuns. Há datasets do dia e global/semana sobrepostos |
| `/api/barbers/availability` | 4 | Uma leitura + 3 comuns. Necessária a formulários de marcação/ausências |

O catálogo de barbeiros já devolve referências de fotos em vez das imagens
embutidas; a Agenda não volta a pedir os avatars desnecessariamente. Essa
otimização não é revertida. A contagem de lojas já é em lote, não N+1.

Outros pedidos e oportunidades a validar antes de implementar:

- Sessão/auth, contexto de loja, barbeiros, serviços e dataset usado pela
  `WeeklyAgenda` são necessários. Não atrasar validações de acesso/loja.
- O dataset do dia alimenta a lista de marcações; a visão da Agenda usa o
  dataset semanal/global. Ambos fazem polling de 10 s. São intervalos
  sobrepostos, não necessariamente pedidos idênticos: filtros e a projeção
  `scope=team` para barbeiros impedem reutilização indiscriminada.
- Auditoria (polling de 15 s) e estatísticas já aguardam a Agenda. Estão abaixo
  da Agenda no mesmo tab, não no tab Relatórios. Um eventual adiamento por
  viewport requer placeholder e testes; não basta ativá-los só em Relatórios.
- Despesas já carregam apenas em Relatórios.
- Blacklist e disponibilidade são usadas no formulário manual. Adiá-las só é
  seguro se o formulário aguardar esses dados; não eliminar validações.
- Shop availability pode já estar em cache após a Home/login. A deduplicação
  da Home está preservada. Locations depende legitimamente da configuração
  multi-location para seleção/autorização.
- No handler de barbeiros, as leituras de associações todas/ativas são
  candidatas a uma leitura única, preservando exatamente a semântica de
  associações inativas. Regras financeiras públicas e dados de foto lidos
  internamente pelo dashboard merecem projeções mais estreitas após auditoria.
- O dashboard usa dados também para métricas históricas/coortes. Não limitar
  simplesmente todas as queries ao período sem conferir cada cálculo.
- Não remover touch da sessão nem cachear identidade/autorização para reduzir
  contagens: isso pode alterar expiração ou revogação de acesso.

Prioridades: **P0** decompor o startup remoto e conservar avatars compactos;
**P1** medir redução de trabalho da rajada (dataset diário, leituras repetidas
do catálogo e painéis abaixo da dobra), com testes de roles/lojas;
**P2** mudar capacidade do pool apenas se o ensaio demonstrar ganho.
Nenhuma destas otimizações adicionais foi aplicada neste commit.

## Ensaio controlado: 4, depois 6, opcionalmente 8

Plano para execução posterior pelo operador em DEV; este commit não altera
configurações externas nem executa deploys.

1. Mesmo SHA, dados, região, instância, flags, role Admin e localização. Fechar
   outros separadores Admin com polling. Registar se há outros utilizadores/
   workers ativos e o limite de ligações da BD, incluindo outras instâncias.
2. Baseline com pool 4: após deploy, recolher todos os `[startup]` e esperar
   `listening`. Distinguir primeiro pedido pós-arranque de pedidos quentes.
3. Fazer pelo menos três percursos Home → login → Agenda, sem criar/editar
   marcações. Fechar todas as janelas privadas entre sessões novas (janelas
   privadas simultâneas podem partilhar sessão). Usar o mesmo procedimento
   de cache/browser e condições de rede para todos os tamanhos do pool.
4. Anotar navegação → conteúdo Home, login → Agenda utilizável e resposta do
   login → Agenda utilizável. No Network registar duração/TTFB por rota e
   distinguir appointments com data vs global. Não exportar passwords,
   cookies, tokens, corpos de login nem HAR não sanitizado.
5. Recolher `[perf]`: `poolMax`, `totalMs`, `sessionMs`, `locationMs`,
   `sqlCount`, `sqlRoundTripMs`, `acquireMs`, `acquireNewMs`,
   `acquireQueuedMs`, `maxPoolQueue`, `jsonMs`. O nome da rota sem query string
   nos logs é intencional; correlacionar os dois datasets pelo Network.
6. Só depois comparar com pool 6 no mesmo SHA, reiniciando com a nova
   configuração em DEV e repetindo o protocolo. Não misturar arranque frio
   com amostras quentes. Um browser novo não garante backend/BD frios.
7. Considerar 8 apenas se 6 ainda tiver fila relevante e a BD tiver margem;
   interromper se SQL/erros/timeouts piorarem. Comparar mediana e intervalo
   mínimo/máximo, não alegar p95 robusto com apenas três amostras.
8. Ganho tem de chegar à Home/Agenda e às rotas críticas, não apenas reduzir
   `acquireQueuedMs`. Como critério de ensaio (não SLA), procurar melhoria
   consistente de pelo menos 15% ou 100 ms no percurso crítico, sem aumento
   de erros nem degradação de round-trip SQL. Sem ganho, manter DEV em 4.

Os 330–530 ms agregados de fila já observados confirmam contribuição do pool,
não uma fração exclusiva do atraso. Nos pedidos quentes a fila quase nula
mostra que aumentar o pool não resolve toda a latência. Não recomendar 6/8
em Production antes de medir. Este ensaio não mede tempo SQL interno puro.

## Recolha no Render DEV

1. Confirmar o serviço **BarberBookings DEV**, repositório oficial e branch
   `development`. Não selecionar o serviço Production.
2. Confirmar `APP_ENV=development`, ativar temporariamente
   `PERFORMANCE_TIMINGS_ENABLED=true` e manter `DATABASE_POOL_MAX=4` para a
   primeira recolha. Não mudar outras flags, URLs ou secrets.
3. Publicar manualmente o SHA deste commit em DEV e confirmar no log que é
   esse o SHA usado. Se guardar env vars sem deploy, o processo em execução
   ainda não usa os novos valores; o deploy seguinte aplica-os.
4. Guardar as linhas `[startup]` desde `process-origin` até `listening`, e os
   timestamps de `starting`/`serving`. Depois recolher `[perf]` dos percursos
   acima e indicar qual foi o primeiro após o arranque.
5. Enviar apenas diagnósticos sanitizados e timings; não enviar env vars
   secretas, conteúdo de mensagens, cookies ou dados de clientes.
6. Desativar a instrumentação após a investigação. Não aumentar ainda para
   6/8: primeiro analisar o baseline novo com 4.
