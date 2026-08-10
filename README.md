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
- Password inicial: `baptista2026`

`RESEND_API_KEY` e opcional. Se ficar vazio, a app continua a funcionar sem envio de emails.

## Mensagens automaticas

O canal de mensagens e escolhido por `MESSAGING_PROVIDER`:

- `MESSAGING_PROVIDER=evolution`: usa Evolution API para WhatsApp.
- `MESSAGING_PROVIDER=twilio`: usa Twilio para WhatsApp.
- `MESSAGING_PROVIDER=none`: desativa mensagens automaticas e deixa apenas email, se configurado.

Se o envio automatico falhar ou nao estiver configurado, a app tenta enviar email como fallback quando o cliente indicou email.

## WhatsApp com Twilio

Para ativar WhatsApp pela Twilio, define as variaveis no ambiente de producao:

- `MESSAGING_PROVIDER=twilio`
- `TWILIO_ACCOUNT_SID`: Account SID da conta Twilio, normalmente com prefixo `AC`
- `TWILIO_API_KEY_SID`: API Key SID, normalmente com prefixo `SK`
- `TWILIO_API_KEY_SECRET`: segredo da API Key
- `TWILIO_WHATSAPP_FROM`: remetente WhatsApp da Twilio, por exemplo `whatsapp:+14155238886` no sandbox ou `whatsapp:+...` no numero aprovado
- `TWILIO_MESSAGING_SERVICE_SID`: opcional; se existir, substitui `TWILIO_WHATSAPP_FROM`
- `TWILIO_BOOKING_CONFIRMATION_CONTENT_SID`: Content SID `HX...` do template aprovado para confirmacao de marcacao
- `TWILIO_BOOKING_CANCELLATION_CONTENT_SID`: Content SID `HX...` do template aprovado para cancelamento de marcacao
- `TWILIO_REQUEST_TIMEOUT_MS=10000`
- `WHATSAPP_DEFAULT_COUNTRY_CODE=351`: usado para normalizar numeros nacionais antes de enviar para a Twilio

Guarda `TWILIO_API_KEY_SECRET` apenas no painel do fornecedor de deploy. Nunca deve ser committed no repositorio.

Para WhatsApp oficial fora da sandbox, a Twilio/Meta pode exigir templates aprovados. O template de confirmacao deve usar estas variaveis:

- `{{1}}`: nome do cliente
- `{{2}}`: data da marcacao
- `{{3}}`: hora da marcacao
- `{{4}}`: barbeiro
- `{{5}}`: servico
- `{{6}}`: link de cancelamento
- `{{7}}`: nome da barbearia

O template de cancelamento deve usar:

- `{{1}}`: nome do cliente
- `{{2}}`: data da marcacao
- `{{3}}`: hora da marcacao
- `{{4}}`: servico
- `{{5}}`: nome da barbearia

## WhatsApp com Evolution API

As mensagens de WhatsApp ficam inativas enquanto a Evolution API nao estiver configurada. A integracao usa o endpoint `POST /message/sendText/{instance}` da Evolution API, com a chave no header `apikey`.

Para ativar no Railway, define:

- `MESSAGING_PROVIDER=evolution`
- `EVOLUTION_API_URL`: URL publica da tua Evolution API, sem barra final
- `EVOLUTION_API_KEY`: chave da Evolution API
- `EVOLUTION_API_INSTANCE`: nome da instancia ligada ao telemovel da barbearia
- `PUBLIC_URL`: URL publica desta app, usada para gerar o link de cancelamento
- `EVOLUTION_WEBHOOK_SECRET`: segredo opcional para validar webhooks da Evolution
- `WHATSAPP_DEFAULT_COUNTRY_CODE=351`
- `SHOP_NAME=Baptista Barber Shop`
- `SHOP_TIME_ZONE=Europe/Lisbon`

Quando estas variaveis existem, a app envia confirmacao de marcacao com link de cancelamento e confirmacao quando o cliente cancela pelo link.

A resposta HTTP 2xx da Evolution API e tratada apenas como aceite para processamento. A entrega fica como `pending` na tabela `whatsapp_messages` e so e confirmada quando a Evolution enviar o webhook `MESSAGES_UPDATE`.

Configura o webhook da instancia para:

- URL: `${PUBLIC_URL}/api/webhooks/evolution`
- Eventos: `MESSAGES_UPDATE`
- Header opcional, se definires `EVOLUTION_WEBHOOK_SECRET`: `Authorization: Bearer <EVOLUTION_WEBHOOK_SECRET>` ou `X-Webhook-Secret: <EVOLUTION_WEBHOOK_SECRET>`

Se usares `webhook_by_events=true`, tambem podes apontar a base para `${PUBLIC_URL}/api/webhooks/evolution`; a rota `/api/webhooks/evolution/messages-update` esta preparada para esse modo.

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
- variaveis do provider de mensagens escolhido, se quiseres envio automatico

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
