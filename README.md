# BarberBookings

Sistema de gestao de clientes para barbearias.

## Ambiente local

### Requisitos

- Node.js 20+
- Docker Desktop ou PostgreSQL local

### Configuracao incluida neste repositorio

- `.env` com defaults locais
- `.env.example` como referencia
- `docker-compose.yml` com PostgreSQL em `localhost:5432`

### Arranque rapido

1. Subir a base de dados:

```powershell
docker compose up -d
```

2. Instalar dependencias:

```powershell
npm install
```

3. Criar o schema na base de dados:

```powershell
npm run db:push
```

4. Arrancar a aplicacao:

```powershell
npm run dev
```

### Testes automaticos

Os testes E2E arrancam a aplicacao numa porta propria com `USE_MEMORY_STORAGE=true`, por isso nao escrevem na base de dados real.

```powershell
npm run test:e2e
```

Para abrir o runner visual do Playwright:

```powershell
npm run test:e2e:ui
```

### URLs e acessos

- App local: `http://localhost:5000`
- PostgreSQL: `postgresql://postgres:postgres@localhost:5432/barberbookings`
- Admin inicial: `admin`
- Password inicial: definida através de `ADMIN_INITIAL_PASSWORD`.

No ambiente de demonstração (`DEMO_MODE=true`), define `DEMO_ADMIN_PASSWORD` com pelo menos 4 caracteres. A conta `admin` existente é sincronizada com esse valor em cada arranque do serviço demo; esta credencial simplificada nunca deve ser reutilizada em produção.

Para enviar notificacoes por email, configura no ambiente de producao:

- `RESEND_API_KEY`: chave da API Resend.
- `RESEND_FROM_EMAIL`: endereco remetente de um dominio verificado na Resend.
- `PUBLIC_URL`: URL publica da app, usada nos links de cancelamento e reagendamento.

Se `RESEND_API_KEY` ficar vazio, a app continua a funcionar, mas nao envia notificacoes.

### Teste isolado da Meta WhatsApp Cloud API em Development

Esta fase nao esta ligada às marcacoes. O endpoint existe apenas em desenvolvimento local ou
quando o deployment define explicitamente `APP_ENV=development`, exige uma sessao de
administrador e recusa qualquer destinatario que nao esteja na allowlist.

Mantem estes valores por defeito:

```env
WHATSAPP_NOTIFICATIONS_ENABLED=false
MESSAGING_PROVIDER=none
```

Para executar especificamente o teste, preenche apenas o ficheiro local `.env` (ignorado pelo
Git) com os dados apresentados no painel da app de teste da Meta:

```env
WHATSAPP_NOTIFICATIONS_ENABLED=true
MESSAGING_PROVIDER=meta
APP_ENV=development
WHATSAPP_DEFAULT_COUNTRY_CODE=351
WHATSAPP_REQUEST_TIMEOUT_MS=10000
META_WHATSAPP_GRAPH_API_VERSION=vXX.X
META_WHATSAPP_PHONE_NUMBER_ID=
META_WHATSAPP_WABA_ID=
META_WHATSAPP_ACCESS_TOKEN=
META_WHATSAPP_TEST_TEMPLATE=hello_world
META_WHATSAPP_TEST_TEMPLATE_LANGUAGE=en_US
META_WHATSAPP_CONFIRMATION_TEMPLATE=appointment_confirmation_v1
META_WHATSAPP_CONFIRMATION_TEMPLATE_LANGUAGE=pt_PT
META_WHATSAPP_RESCHEDULED_TEMPLATE=appointment_rescheduled_v1
META_WHATSAPP_RESCHEDULED_TEMPLATE_LANGUAGE=pt_PT
META_WHATSAPP_CANCELLED_TEMPLATE=appointment_cancelled_v1
META_WHATSAPP_CANCELLED_TEMPLATE_LANGUAGE=pt_PT
META_WHATSAPP_DEV_ALLOWLIST=3519XXXXXXXX
```

`META_WHATSAPP_DEV_ALLOWLIST` aceita varios numeros E.164 separados por virgula. Com o numero de
teste da Meta, cada destinatario tambem tem de estar adicionado e verificado no painel da Meta.
Reinicia `npm run dev` depois de alterar o `.env`.

Num deployment DEV que execute o build com `NODE_ENV=production`, como o comando `npm start` no
Render ou Railway, `APP_ENV=development` e obrigatoria. Nao definir esta variavel em Production.

Com o backend a correr, este exemplo PowerShell autentica no backend sem colocar a password na
linha de comandos, envia o template e consulta o registo persistido:

```powershell
$baseUrl = "http://localhost:5000"
$credential = Get-Credential -UserName "admin" -Message "Credenciais do admin de Development"
$session = New-Object Microsoft.PowerShell.Commands.WebRequestSession
$loginBody = @{
  username = $credential.UserName
  password = $credential.GetNetworkCredential().Password
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "$baseUrl/api/admin/login" `
  -WebSession $session -ContentType "application/json" -Body $loginBody

$test = Invoke-RestMethod -Method Post -Uri "$baseUrl/api/admin/dev/whatsapp/meta/test" `
  -WebSession $session -ContentType "application/json" `
  -Body (@{ recipient = "+3519XXXXXXXX" } | ConvertTo-Json)
$test

Invoke-RestMethod -Method Get `
  -Uri "$baseUrl/api/admin/dev/whatsapp/meta/test/$($test.recordId)" `
  -WebSession $session
```

Uma resposta aceite inclui `accepted=true`, `recordId`, `wamid`, `status=pending`, o HTTP da Meta
e o destinatario mascarado. O `GET` devolve o mesmo `wamid` a partir da tabela
`whatsapp_messages`. Uma recusa da Meta tambem cria um registo `failed` e devolve o respetivo
`recordId`, sem expor o access token nem o corpo integral do provider.

No fim do teste, volta a colocar `WHATSAPP_NOTIFICATIONS_ENABLED=false`. A Evolution API continua
disponivel no codigo, mas so pode ser selecionada explicitamente com
`MESSAGING_PROVIDER=evolution`; o email permanece independente.

### Notificacoes de marcacao em Development

Em Development, confirmacoes publicas/manuais, reagendamentos e cancelamentos publicos criam um
evento transacional persistente. Com opt-in, Meta e o canal principal; sem aceitacao/`wamid`, o
backend tenta uma unica vez o email. Marcacoes manuais sem opt-in continuam por email. Um worker
com lease recupera eventos pendentes apos restart sem repetir tentativas WhatsApp ambiguas.

A resposta do reagendamento inclui `notificationEventId`. Depois de autenticar como admin, o
resultado seguro pode ser consultado em:

```text
GET /api/admin/dev/notifications/appointment/:appointmentId
```

Este endpoint, a criacao do outbox e os envios automaticos ficam desativados quando
o deployment nao for reconhecido como Development.

### Webhook Meta em modo de observacao

O webhook fica desligado por defeito. Para o ativar apenas em DEV, definir no gestor de secrets:

```env
META_WHATSAPP_WEBHOOK_ENABLED=true
META_WHATSAPP_WEBHOOK_VERIFY_TOKEN=
META_WHATSAPP_APP_SECRET=
NOTIFICATION_OUTBOX_POLL_INTERVAL_MS=5000
```

Callback: `https://barberbookings-dev.onrender.com/api/webhooks/whatsapp/meta`. O GET valida o
verify token e o POST valida `X-Hub-Signature-256` sobre o raw body. Estados `sent`, `delivered`,
`read` e `failed` sao persistidos; nesta fase um `failed` por webhook nao envia email tardio.

## Mensagens automaticas

As confirmacoes de marcacao e de cancelamento sao enviadas diretamente por email quando o cliente indica um endereco. O email de confirmacao inclui os detalhes da marcacao e os links para reagendar e cancelar.

## Deploy no Railway

O repositorio inclui `railway.json` para deixar o deploy explicito:

- Build command: `npm run build`
- Start command: `npm start`
- Healthcheck: `/health`

A app ja usa `process.env.PORT`, que o Railway injeta automaticamente. Se usares o dominio automatico do Railway, podes definir:

```env
PUBLIC_URL=https://${{ RAILWAY_PUBLIC_DOMAIN }}
ALLOWED_ORIGINS=https://${{ RAILWAY_PUBLIC_DOMAIN }}
```

Variaveis minimas para a app no Railway:

- `DATABASE_URL`: URL do Postgres
- `DATABASE_SCHEMA=public`
- `DATABASE_POOL_MAX=2`: limite total de ligacoes partilhadas pela app e pelas sessoes
- `SESSION_SECRET`: segredo forte para sessoes
- `PUBLIC_URL`: dominio publico da app
- `ALLOWED_ORIGINS`: mesmo dominio publico da app
- `RESEND_API_KEY` e `RESEND_FROM_EMAIL` para envio das notificacoes

Depois de ligares a base de dados, executa `npm run db:push` uma vez para criar/atualizar as tabelas.

## Deploy separado

Para publicar o frontend na Cloudflare e a API no Render:

- Cloudflare Pages
  - Build command: `npm run build:client`
  - Output directory: `dist/public`
  - Environment variable: `VITE_API_URL=https://api.teudominio.com`
- Render Web Service
  - Build command: `npm run build:server`
  - Start command: `npm start`
  - Environment variables:
    - `DATABASE_URL=postgresql://...`
    - `DATABASE_SCHEMA=public` ou o schema usado na BD, por exemplo `barberbooking`
    - `PUBLIC_URL=https://app.teudominio.com`
    - `ALLOWED_ORIGINS=https://app.teudominio.com`
    - `SESSION_SAME_SITE=lax`

Se precisares de aceitar mais do que uma origem no backend, usa `ALLOWED_ORIGINS` com valores separados por virgula.
Se estiveres a testar com dominios diferentes do fornecedor, como `pages.dev` e `onrender.com`, usa `SESSION_SAME_SITE=none`.
