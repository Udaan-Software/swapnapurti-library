# Deployment and operations

## Local / desktop

Run `npm start`. Docker Compose keeps PostgreSQL running with `restart: unless-stopped`; the application can therefore be reopened without manually starting each component. Enable **Launch with Windows** in Settings after installing the packaged desktop application.

## Production web deployment

1. Provision PostgreSQL 17 and create database `swpanpurati`.
2. Supply `DATABASE_URL`, `FRONTEND_URL`, `NODE_ENV=production`, and cookie/session settings through the host's secret manager.
3. Run `npm ci`, `npm run build`, and `npm run db:deploy --workspace backend`.
4. Serve `frontend/dist` behind HTTPS and reverse proxy `/api` to the API on port 5000.
5. Schedule `pg_dump --format=custom swpanpurati` to encrypted off-host storage and test restores regularly.

Do not run database reset commands during application startup. Restore operations should be performed only after verifying the target and taking a current snapshot.
