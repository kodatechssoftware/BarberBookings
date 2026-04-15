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
