# Swapnapurti Library Management System

A unified study-library and book-lending system for one administrator. The repository contains a React/Vite web client, an Electron desktop client, an Express API, Prisma, and PostgreSQL.

## Start everything with one command

Prerequisites: Node.js 22+ and Docker Desktop.

```powershell
npm install
npm start
```

`npm start` starts PostgreSQL, applies migrations, inserts idempotent defaults, starts the API and web client, and opens the desktop application. On first launch, create the administrator in the secure setup screen. No default password is installed.

Use `npm run web` for the browser-only version. Once services are running, open http://localhost:5173. The API health endpoint is http://localhost:5000/health.

## Useful commands

```powershell
npm run build
npm test
npm run lint
npm run db:up
npm run db:migrate
npm run desktop:package
npm run backup
```

The database is named exactly `swpanpurati`. PostgreSQL uses its standard port 5432 inside Docker and is mapped to host port 55432 because this workstation already uses host ports 5432 and 5433. Local Docker data persists in the `swapnapurti_postgres` volume, so closing the app does not remove records. The portable desktop edition can be configured to launch at Windows login from Settings.

## Configuration

Copy `.env.example` to `.env` for custom credentials or ports. Never commit that file. The development launcher uses the safe local-only Docker defaults when variables are absent. Production deployments must supply their own database credentials, secure HTTPS cookie context, and backup location.

## Date and accounting policy

- Subscription dates are inclusive. A one-month plan beginning 10 January ends 9 February.
- Money is stored as PostgreSQL `DECIMAL(12,2)` and transported as decimal strings.
- Collections count recorded payments. Invoices, fines assessed, refunds, expenses, and outstanding amounts remain distinct.
- Seat allocation is separate from physical attendance. Overlapping full-day and individual-shift allocations are rejected under a locked transaction.
- Every physical book copy has its own accession number, barcode, condition, status, and loan history.

See [docs/architecture.md](docs/architecture.md), [docs/database-design.md](docs/database-design.md), [docs/api-documentation.md](docs/api-documentation.md), [docs/deployment.md](docs/deployment.md), and [docs/implementation-report.md](docs/implementation-report.md) for operational details and verified limitations.
