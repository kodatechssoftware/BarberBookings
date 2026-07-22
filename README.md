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

## WhatsApp com Evolution API

As mensagens de WhatsApp ficam inativas enquanto a Evolution API nao estiver configurada. A integracao usa o endpoint `POST /message/sendText/{instance}` da Evolution API, com a chave no header `apikey`.

Para ativar no Railway, define:

- `EVOLUTION_API_URL`: URL publica da tua Evolution API, sem barra final
- `EVOLUTION_API_KEY`: chave da Evolution API
- `EVOLUTION_API_INSTANCE`: nome da instancia ligada ao telemovel da barbearia
- `PUBLIC_URL`: URL publica desta app, usada para gerar o link de cancelamento
- `WHATSAPP_DEFAULT_COUNTRY_CODE=351`
- `SHOP_NAME=Baptista Barber Shop`
- `SHOP_TIME_ZONE=Europe/Lisbon`

Quando estas variaveis existem, a app envia confirmacao de marcacao com link de cancelamento e confirmacao quando o cliente cancela pelo link.
O WhatsApp e o canal principal; se o envio falhar ou a Evolution API nao estiver configurada, a app tenta enviar email como fallback quando o cliente indicou email.

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
- `EVOLUTION_API_URL`
- `EVOLUTION_API_KEY`
- `EVOLUTION_API_INSTANCE`

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
