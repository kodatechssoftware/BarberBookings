# Repair de encoding: mesma passagem, menos round-trips

## Âmbito

O repair continua no mesmo ponto do startup, em todos os arranques PostgreSQL,
com BEGIN/COMMIT, rollback e libertação da ligação. Não passa a one-time nem
background. Sem alterações a pool, ensure*, migrations ou dados-seed.
O modo memory continua a ignorar esta rotina.

Antes: BEGIN + 112 UPDATEs + COMMIT = **114 comandos/round-trips**.
Depois: BEGIN + 7 comandos com um UPDATE cada + COMMIT = **9** (**−92,1%**).
Não é apenas um pacote contendo os mesmos 112 UPDATEs: existem sete UPDATEs
reais, com as 16 transformações aplicadas à expressão de cada campo.

## Mapa histórico imutável (ordem 1 → 16)

`\uFFFD` abaixo designa o carácter Unicode de substituição, não seis caracteres
literais. Não há normalização Unicode, regex, trim ou alteração de capitalização.

| # | Procurar | Substituir por |
| --- | --- | --- |
| 1 | `Corte cl?ssico e barba` | `Corte clássico e barba` |
| 2 | `Perfil de demonstra??o DEV` | `Perfil de demonstração` |
| 3 | `Perfil de demonstra\uFFFD\uFFFDo DEV` | `Perfil de demonstração` |
| 4 | `Perfil de demonstração DEV` | `Perfil de demonstração` |
| 5 | `Jo?o Mendes` | `João Mendes` |
| 6 | `Lu?s Freitas` | `Luís Freitas` |
| 7 | `Tom?s Almeida` | `Tomás Almeida` |
| 8 | `S?rgio Matos` | `Sérgio Matos` |
| 9 | `Gon?alo Reis` | `Gonçalo Reis` |
| 10 | `C?sar Monteiro` | `César Monteiro` |
| 11 | `F?bio Lopes` | `Fábio Lopes` |
| 12 | `Sim?o Pires` | `Simão Pires` |
| 13 | `Andr\uFFFD Silva (DEV)` | `André Silva` |
| 14 | `Gon\uFFFDalo Costa (DEV)` | `Gonçalo Costa` |
| 15 | `André Silva (DEV)` | `André Silva` |
| 16 | `Gonçalo Costa (DEV)` | `Gonçalo Costa` |

Campos, também pela ordem original:

1. `barbers.name`
2. `barbers.specialty`
3. `barbers.bio`
4. `appointments.customer_name`
5. `audit_logs.actor_name`
6. `audit_logs.summary`
7. `audit_logs.metadata` (text, não conversão/serialização JSON)

No schema versionado, estes campos não têm triggers, colunas geradas ou
constraints cruzadas que dependam dos estados intermédios do repair. Cada
transformação depende apenas do próprio campo. Continua a mesma ordem dos
campos; não se agruparam tabelas.

## Equivalência da expressão e do contador

Para um valor `v0`, a regra i calcula exatamente:

```text
vi = replace(v(i−1), origem[i], destino[i])
hi = h(i−1) + (position(origem[i] in v(i−1)) > 0 ? 1 : 0)
```

A expressão final equivale a `replace(replace(...replace(v0, regra1), regra2)...,
regra16)`. Usa subqueries LATERAL encadeadas com OFFSET 0 para não reavaliar a
expressão crescente em cada etapa do valor/contador.

A CTE materializada seleciona candidatos e bloqueia as linhas com
`FOR NO KEY UPDATE` antes de guardar o valor original. Uma escrita concorrente
concluída enquanto se aguarda o lock não é sobrescrita por uma pré-imagem antiga.
A associação ao UPDATE usa a PK `id`, presente nas três tabelas. O UPDATE
escreve `v16`, devolve `h16` e a query agrega os hits. Os valores continuam
parametrizados e os identificadores validados/quoted por `db.ts`.

O filtro inicial procura qualquer padrão: sem nenhum padrão inicial, nenhuma
primeira transformação pode ocorrer e criar outro. NULL não é candidato;
strings vazias/corretas não são escritas. `replace` substitui todas as
ocorrências literalmente, como antes.

O contador preserva a soma de linhas correspondentes **por regra e campo**,
não ocorrências nem linhas distintas. `Jo?o Mendes / Jo?o Mendes / Lu?s Freitas`
conta 2 por campo, não 3 nem 1.

## Encadeamentos: limitação preexistente preservada

A ordem importa quando texto adjacente permite que uma regra forme o padrão
de outra: `Perfil de demonstra??o DEV DEV` passa pelas regras 2 e 4;
`Andr\uFFFD Silva (DEV) (DEV)` pelas regras 13 e 15. Também existem as relações
3/4 e 14/16. **Não se iteram as regras até estabilizar.**

| Entrada | Primeira execução (ambos) | Segunda execução (ambos) |
| --- | --- | --- |
| `Perfil de demonstração DEV DEV` | `Perfil de demonstração DEV` | `Perfil de demonstração` |
| `André Silva (DEV) (DEV)` | `André Silva (DEV)` | `André Silva` |
| `Perfil de demonstra??o DEV DEV DEV` | `Perfil de demonstração DEV` | `Perfil de demonstração` |

A idempotência absoluta destes casos não existe no algoritmo histórico e não
foi introduzida nesta otimização. Strings normais reparadas permanecem estáveis.

## Prova e medições locais

`npx tsx --test tests/unit/text-encoding-repair.test.ts` cria PostgreSQL UTF8
efémero em loopback e compara a rotina real nova com uma cópia congelada do
algoritmo de `0134642`. Não usa BD/env vars reais. O oráculo tem cópias próprias
das regras/campos e não usa o builder novo.

Cobertura: NULL/vazio/correto, U+FFFD, Unicode/emoji, várias ocorrências, JSON
armazenado como texto, todos os pares adjacentes/separados, cadeias, primeira e
segunda execução, contador, zero dados, milhares de registos, rollback no último
campo, atomicidade observada noutra conexão e escritor concorrente. Compara
**bytes UTF8 em hexadecimal** nos sete campos e verifica um campo não abrangido.
Dados já corretos mantêm xmin/ctid: nenhum UPDATE físico desnecessário.

Benchmark sem latência artificial, conexão quente; setup/snapshots excluídos.
Uma passagem de aquecimento e três amostras com ordem alternada; igualdade
verificada em todas as amostras.

| Cenário | Antes (ms), 3 amostras | Depois (ms), 3 amostras | Medianas |
| --- | --- | --- | --- |
| 1.000 linhas corretas/tabela; 3 tabelas | 18,62 / 19,22 / 18,78 | 13,06 / 12,16 / 12,82 | 18,78 → 12,82 (−31,7%) |
| 2.000 linhas mistas/tabela; 3 tabelas; 25.102 hits | 209,68 / 161,87 / 151,16 | 176,18 / 201,52 / 159,36 | 161,87 → 176,18 (+8,8%) |

Num ensaio anterior do cenário misto: 177,39 / 170,39 / 168,16 ms contra
165,80 / 163,54 / 164,09 ms (medianas −3,7%). Portanto **não há ganho local
consistente demonstrado com muitos textos a reparar**; existe variação e custo
da expressão/plano. Não ocultar este resultado. O ganho estrutural comprovado
é a redução de 105 round-trips e de UPDATEs físicos. O benefício remoto tem de
ser medido, não extrapolado destes números.

## Riscos e limites

- Não elimina todas as pesquisas de texto nem transforma o repair em one-time.
- Materializa candidatos e usa expressões mais complexas. Tempo/memória
  dependem do volume e proporção de dados afetados. Menos round-trips não
  garante menos CPU/tempo em loopback, como mostra o cenário misto.
- Equivalência de valores aplicacionais e contador no schema versionado.
  Menos UPDATEs implica menos versões físicas/interações com triggers.
  Triggers, RLS ou constraints externos ao repositório requerem auditoria
  própria; não foram inspecionados na BD Production.
- Mantêm-se transação e locks; não se reusa pré-imagem stale. Não se promete
  reproduzir todas as interleavings entre escritores concorrentes: 112
  statements tinham mais fronteiras de snapshot READ COMMITTED que sete.
  Nenhum algoritmo garante reparar escritas posteriores à passagem pelo campo.
- Garantias de booking/anti-overlap estão fora desta alteração. Não foram
  modificadas transações de marcações, ensures ou migrations.
- Os ~9,55 s anteriores eram DEV Render Free, não uma medida de PRD pago.
