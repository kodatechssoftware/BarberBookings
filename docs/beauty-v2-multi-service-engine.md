# Beauty v2 — motor de marcações multi-serviço

Estado: motor híbrido sequencial/paralelo, pedidos públicos e leitura Admin implementados na branch isolada Beauty v2.

## Gate de ativação

O motor é fail-closed e só persiste uma marcação quando as condições aplicáveis são verdadeiras:

1. `BUSINESS_VERTICAL=beauty`;
2. `BEAUTY_V2_FEATURES_ENABLED=true`;
3. `multiServiceAppointments=true` na instalação ou na localização (com override local);
4. para execução simultânea, `parallelServiceScheduling=true` na localização.

Os defaults continuam desligados. A migration não cria settings, marcações, segmentos ou notificações.

## Modelo aditivo

`0024_multi_service_appointment_engine.sql` acrescenta:

- `appointment_service_sets`: marcador explícito de que a marcação usa o motor v2;
- `appointment_service_segments`: sequência ordenada e com snapshots imutáveis de serviço, profissional, preço, duração e buffers;
- triggers diferidos de consistência entre o resumo legacy e os segmentos;
- projeção de ocupação por profissional sobre `appointment_occupancy_periods`.

As marcações existentes não recebem service set nem segmentos e continuam a usar integralmente a projeção legacy criada pela `0021`.

## Compatibilidade com o modelo atual

Para uma marcação multi-serviço, `appointments` mantém um resumo legível pelo código v1:

- início: início do primeiro segmento;
- duração: intervalo real entre o início da primeira etapa e o fim da última;
- serviço e profissional: primeiro segmento;
- nome: nomes dos serviços unidos, limitado ao tamanho legacy;
- preço: soma dos preços dos segmentos;
- buffer inicial/final: primeiro buffer-before e último buffer-after.

O resumo não substitui os segmentos como fonte v2. Constraints diferidas impedem que uma alteração legacy deixe os dois modelos inconsistentes. Marcações sem service set mantêm os campos legacy como única fonte autoritativa.

## Ocupação e concorrência

Por omissão, cada serviço começa quando termina a duração comercial do anterior.
A migration `0026_parallel_service_scheduling.sql` acrescenta
`execution_stage` aos segmentos e uma matriz explícita, por localização, em
`parallel_service_compatibilities`. Serviços da mesma etapa começam juntos; a
etapa seguinte começa quando termina o serviço comercial mais longo da anterior.
O planeador só agrupa serviços quando todas as combinações do grupo são
compatíveis e os profissionais são diferentes. Buffers continuam a reservar
tempo operacional por profissional.

A criação:

- bloqueia localização, catálogo e atribuições relevantes;
- valida que todos os segmentos cabem integralmente nos horários da localização/profissional;
- adquire advisory locks por profissional/dia numa ordem determinística;
- verifica conflitos no início de qualquer período operacional;
- depende também da exclusion constraint PostgreSQL como última barreira concorrente;
- grava resumo, service set e segmentos numa única transação.

Uma falha em qualquer segmento, constraint ou passo anterior ao commit reverte toda a marcação.

## Operação e compatibilidade

- A alteração da matriz não reescreve marcações existentes; os estágios ficam
  guardados como snapshots.
- A aprovação e a aceitação de propostas revalidam a matriz e a disponibilidade
  na transação final.
- Cancelar a marcação liberta todos os períodos através da projeção existente.
- A agenda expande apenas a apresentação: mostra a mesma marcação em cada
  profissional/segmento, mantendo um único `appointment_id`.
- Os detalhes mostram serviços, profissionais, etapas, horários e preços.
- O reagendamento genérico fica bloqueado de forma segura para marcações
  multi-serviço. É necessário cancelar/criar novamente até existir um editor
  transacional dedicado; nunca é movido apenas o resumo legacy.

## Limites intencionais desta fase

- 2 a 12 serviços por marcação;
- etapas contíguas, sem intervalos livres entre elas;
- cada segmento pode ter profissional diferente;
- recorrências e availability windows não são combinadas com multi-serviço nesta fase;
- não existe gestão de recursos físicos (cabines/equipamentos);
- notificações continuam sujeitas às flags/providers já existentes e não são ativadas por esta evolução;
- o resumo financeiro da marcação conserva o preço total, mas esta fase não
  reparte automaticamente compensação/comissão pelos vários profissionais;
  essa combinação deve permanecer desativada até existir um modelo financeiro
  multi-profissional validado;
- não foi executada qualquer migration remota.

Para ativar, é necessário aplicar primeiro a `0026`, configurar explicitamente
os pares compatíveis e só depois ligar `parallelServiceScheduling` na
localização. O kill switch global continua a permitir rollback funcional sem
reescrever marcações existentes.
