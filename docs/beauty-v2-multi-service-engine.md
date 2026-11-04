# Beauty v2 — motor de marcações multi-serviço

Estado: Fase 2, camada de dados e motor. Não existe ainda UI pública ou Admin para criar estas marcações.

## Gate de ativação

O motor é fail-closed e só persiste uma marcação quando as três condições são verdadeiras:

1. `BUSINESS_VERTICAL=beauty`;
2. `BEAUTY_V2_FEATURES_ENABLED=true`;
3. `multiServiceAppointments=true` na instalação ou na localização (com override local).

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
- duração: soma das durações comerciais;
- serviço e profissional: primeiro segmento;
- nome: nomes dos serviços unidos, limitado ao tamanho legacy;
- preço: soma dos preços dos segmentos;
- buffer inicial/final: primeiro buffer-before e último buffer-after.

O resumo não substitui os segmentos como fonte v2. Constraints diferidas impedem que uma alteração legacy deixe os dois modelos inconsistentes. Marcações sem service set mantêm os campos legacy como única fonte autoritativa.

## Ocupação e concorrência

Cada serviço começa quando termina a duração comercial do anterior. Buffers continuam a reservar tempo operacional por profissional. Períodos sobrepostos ou adjacentes do mesmo profissional, dentro da mesma marcação, são unidos antes de alimentar `appointment_occupancy_periods`.

A criação:

- bloqueia localização, catálogo e atribuições relevantes;
- valida que todos os segmentos cabem integralmente nos horários da localização/profissional;
- adquire advisory locks por profissional/dia numa ordem determinística;
- verifica conflitos no início de qualquer período operacional;
- depende também da exclusion constraint PostgreSQL como última barreira concorrente;
- grava resumo, service set e segmentos numa única transação.

Uma falha em qualquer segmento, constraint ou passo anterior ao commit reverte toda a marcação.

## Limites intencionais desta fase

- 2 a 12 serviços por marcação;
- serviços sequenciais, sem intervalos livres entre eles;
- cada segmento pode ter profissional diferente;
- recorrências e availability windows não são combinadas com multi-serviço nesta fase;
- não existem rotas públicas, alterações de booking, notificações ou interface;
- não foi executada qualquer migration remota.

Antes de expor a funcionalidade numa fase seguinte, as rotas devem usar exclusivamente o motor transacional, resolver o scope da localização autenticada e devolver os segmentos sem tornar a projeção interna de ocupação pública.
