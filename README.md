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

### URLs e acessos

- App local: `http://localhost:5000`
- PostgreSQL: `postgresql://postgres:postgres@localhost:5432/barberbookings`
- Admin inicial: `admin`
- Password inicial: `baptista2026`

`RESEND_API_KEY` e opcional. Se ficar vazio, a app continua a funcionar sem envio de emails.

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
