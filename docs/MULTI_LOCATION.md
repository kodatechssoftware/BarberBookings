# Várias localizações — implementação em DEV

Esta funcionalidade serve várias lojas da **mesma empresa**, na mesma instalação. Não separa clientes/empresas independentes. A Baptista em produção mantém a instalação, a base de dados e a branch `main` independentes.

## Configuração no Render

DEV/demonstração:

```ini
MULTI_LOCATION_ENABLED=true
MAX_LOCATIONS=4
SHOP_TIME_ZONE=Europe/Lisbon
```

Uma instalação de uma única loja mantém `MULTI_LOCATION_ENABLED=false` e `MAX_LOCATIONS=1`. As variáveis são lidas no servidor; não precisam de duplicação `VITE_`. `MAX_LOCATIONS` é o limite contratado, não o número atual de lojas. Não copiar variáveis, bases de dados nem seeds de DEV para PRD ao promover código.

## Preparar uma nova loja

1. Como administrador, abrir **Localizações** e criar a loja com nome, morada e ligações do mapa. Nasce como rascunho.
2. Escolher essa loja em **Loja em gestão**.
3. Criar os serviços, preços e durações; configurar o horário da loja.
4. Criar barbeiros ou usar **Associar barbeiro existente**. Rever os serviços e o horário de cada um nessa loja.
5. Ativar a localização depois de validar os dados.
6. No site público, confirmar equipa, serviços, mapa e um percurso de marcação nessa loja.

Uma loja ativa pode aparecer no mapa, mas só é oferecida para marcação se tiver um barbeiro ativo que execute um serviço ativo dessa loja. Uma única loja disponível é selecionada automaticamente; com várias, o cliente escolhe primeiro a loja.

Não se pode desativar a localização principal nem uma loja com marcações futuras por resolver. Arquivar um barbeiro numa loja não o retira das restantes nem apaga o histórico.

## Separação funcional

| Por localização | Partilhado na empresa |
| --- | --- |
| Agenda, marcações públicas/manuais e recorrências | Identidade e conta de acesso do barbeiro |
| Serviços, preços e durações (registos próprios) | Perfil/fotografia do barbeiro partilhado |
| Horário da loja e do barbeiro nessa loja | Condições de remuneração do barbeiro |
| Despesas, resumo financeiro e Excel | Contactos bloqueados e notas de clientes |
| Histórico de marcações consultado nessa loja | Administradores e auditoria |

O administrador gere as lojas da instalação. Um barbeiro só pode selecionar lojas ativas às quais está associado. Consulta a agenda da equipa dessas lojas, mantendo as restrições existentes nas alterações e nos relatórios pessoais. Não recebe acesso às despesas ou à configuração das lojas.

Uma pessoa associada a duas lojas não pode receber marcações sobrepostas. A ocupação pública entre lojas é anonimizada. Não há cálculo de tempo de deslocação: configurar horários por loja com margens adequadas.

## Contratos técnicos

- `X-Location-Id` identifica a loja; o servidor valida loja e permissões. Sem cabeçalho, usa a principal. Com a funcionalidade desligada, ignora o cabeçalho.
- IDs de barbeiros, serviços, despesas e marcações são validados contra a loja em gestão.
- As chaves de cache incluem localização e os pedidos mantêm o cabeçalho da sua chave. Trocar de loja limpa operações/formulários abertos.
- Reagendamento/cancelamento por token usa a localização original da marcação, não a seleção do navegador.
- Emails de confirmação usam nome, morada e fuso da loja. Em modo de loja única mantêm a configuração anterior.
- A abertura mensal continua a ser por instalação: `PUBLIC_BOOKING_MONTHLY_WINDOW_ENABLED` e `PUBLIC_BOOKING_NEXT_MONTH_OPEN_DAY`. As marcações manuais mantêm a exceção administrativa.
- A restrição PostgreSQL de sobreposição é por barbeiro, independentemente da loja. Séries recorrentes com conflitos não são guardadas parcialmente.

## Migração e proteção

O arranque acrescenta as estruturas com uma transação e um bloqueio de migração. Dados antigos recebem a localização principal. Arranques posteriores preservam associações, incluindo arquivadas, e não voltam a associar à principal barbeiros/serviços exclusivos de outra loja. Esta migração não elimina nem recria marcações e não altera as suas horas.

Antes de uma futura promoção a PRD: backup verificado, migração numa cópia isolada, revisão do diff e validação da instalação de loja única. Não usar `db:push` indiscriminadamente na base real. Reverter código/flags não reverte a migração; não eliminar tabelas/colunas para fazer rollback.

## Limites desta fase

- Todas as lojas usam `SHOP_TIME_ZONE`; a API rejeita fusos diferentes. Uma combinação Lisboa/Açores não é suportada nesta fase.
- Perfil, credenciais e remuneração de um barbeiro partilhado são globais. O aluguer de cadeira não permite partilha entre lojas, para não duplicar rendas. Comissão/modelo próprio calculam-se sobre as marcações de cada loja.
- Não há relatório consolidado de todas as lojas nem transferência automática de marcações entre lojas.
- Os testes automáticos desativam fornecedores externos. A entrega real de email deve ser validada separadamente em DEV com um destinatário autorizado.

## Testes reproduzíveis

Validação local em 6–7 de setembro de 2026: 99 testes de regressão/branding, 7 de abertura mensal e a bateria integrada de várias localizações passaram. `npm run check`, `npm run build` e o teste de migração PostgreSQL também passaram. Isto não substitui a validação do deploy real de DEV nem constitui autorização para promover a PRD.

```powershell
npm run check
npm run build
npx playwright test --config=playwright.multilocation.config.ts
npx playwright test tests/e2e/booking-smoke.spec.ts
npx playwright test --config=playwright.booking-window.config.ts
```

A bateria multi-localização cobre quatro lojas, rascunhos, limites, mapas responsivos, isolamento, associação pela interface, conflitos simultâneos, ocupação sem dados pessoais, reagendamento, despesas/Excel, arquivo/reativação e acesso de barbeiros.

Teste da migração numa instância PostgreSQL local e descartável:

```powershell
$env:TEST_DATABASE_URL='postgresql://test@127.0.0.1:55439/postgres'
npx tsx script/test-multi-location-db.ts
```

O script recusa destinos fora de loopback, cria um schema sintético único e testa dados anteriores à migração, arranques repetidos/concorrentes, associações e bloqueio de reservas sobrepostas entre lojas. Remove apenas o próprio schema. Nunca usa `DATABASE_URL` da aplicação para escolher o destino do teste.
