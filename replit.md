# Baptista Barber Shop - Booking System

## Overview

A premium barbershop appointment booking system built for "Baptista Barber Shop". The application allows customers to book appointments with barbers, select services, choose time slots, and manage their bookings. It features a dark, gold-accented luxury theme with Portuguese (Brazilian) language interface.

The system includes:
- Public-facing booking flow with multi-step wizard
- Landing page showcasing services and barbers
- Admin dashboard for appointment management
- RESTful API with typed contracts

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Framework**: React 18 with TypeScript
- **Routing**: Wouter (lightweight React router)
- **State Management**: TanStack React Query for server state
- **Styling**: Tailwind CSS with shadcn/ui component library
- **Animations**: Framer Motion for smooth transitions
- **Build Tool**: Vite with HMR support

The frontend follows a pages-based structure under `client/src/pages/` with reusable components in `client/src/components/`. Custom hooks in `client/src/hooks/` encapsulate data fetching logic for barbers, services, and appointments.

### Backend Architecture
- **Framework**: Express.js with TypeScript
- **Database ORM**: Drizzle ORM with PostgreSQL
- **API Design**: RESTful endpoints with Zod validation
- **Shared Types**: Contract-first API design in `shared/routes.ts`

The server uses a storage abstraction pattern (`server/storage.ts`) that wraps database operations, making it easy to swap implementations. API routes are defined with input/output schemas for type safety across the stack.

### Data Model
Three main entities defined in `shared/schema.ts`:
- **Barbers**: Professional staff with name, specialty, bio, avatar
- **Services**: Offerings with name, description, price (in cents), duration (minutes)
- **Appointments**: Bookings linking barber, service, customer info, and time slot

### Build System
- Development: Vite dev server with Express backend via `tsx`
- Production: esbuild bundles server, Vite builds client to `dist/`
- Database migrations: Drizzle Kit with `db:push` command

## External Dependencies

### Database
- **PostgreSQL**: Primary data store via `DATABASE_URL` environment variable
- **Drizzle ORM**: Type-safe database queries with schema in `shared/schema.ts`
- **connect-pg-simple**: Session storage (available but may not be fully implemented)

### UI Component Libraries
- **shadcn/ui**: Pre-built accessible components (new-york style)
- **Radix UI**: Underlying primitive components
- **Lucide React**: Icon library

### Key NPM Packages
- `@tanstack/react-query`: Server state management
- `framer-motion`: Animation library
- `react-day-picker`: Calendar component for date selection
- `date-fns`: Date manipulation with `ptBR` locale
- `zod`: Schema validation for API contracts
- `drizzle-zod`: Generate Zod schemas from Drizzle tables

### Replit-Specific Integrations
- `@replit/vite-plugin-runtime-error-modal`: Error overlay in development
- `@replit/vite-plugin-cartographer`: Code navigation (dev only)
- `@replit/vite-plugin-dev-banner`: Development banner (dev only)