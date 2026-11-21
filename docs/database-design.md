# Database design

The normalized Prisma schema is in `backend/prisma/schema.prisma`; the executable initial migration is in `backend/prisma/migrations/20261116000000_initial/migration.sql`.

Core domains are administrator sessions/audit, unified members, plans/subscriptions, rooms/shifts/seats/allocations, attendance, book titles/copies/loans/reservations, invoices/payments/refunds/fines, expenses, notifications, and application settings. Financial values use `DECIMAL(12,2)`. Public member, invoice, and receipt identifiers use PostgreSQL sequences.

Database-enforced partial indexes prevent two active loans for one copy and two open attendance sessions for one member. A GiST exclusion constraint prevents overlapping allocations for the same seat and shift; the locked allocation transaction additionally evaluates cross-shift and full-day overlap.
