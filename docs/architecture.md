# Architecture

The application is a modular monolith with three runtime surfaces:

- `frontend`: React, Vite, TanStack Query, React Router, Tailwind CSS, Radix primitives, React Hook Form/Zod, Recharts, Sonner.
- `backend`: Express REST API with controller-level routing, centralized services/rules, Prisma, validation, session authentication, CSRF protection, rate limiting, and audit logging.
- `desktop`: Electron shell. Development reuses the Vite UI and API. The packaged shell starts the local database/API lifecycle and loads the built UI.

All operational records share one PostgreSQL database and unified `Member` identity. Financial, inventory, attendance, subscription, and audit history is retained rather than destructively overwritten.

## Security boundary

The API is private to the administrator. A random session token is stored only in an HTTP-only SameSite cookie; only its SHA-256 digest is persisted. Mutations also require the session CSRF token. Passwords use Argon2id. First-run setup is disabled permanently after the first administrator exists.

## Important invariants

- Member IDs and receipt/invoice numbers use PostgreSQL sequences.
- Seat issue checks execute under a row lock and compare both date and shift overlap.
- Book issue locks the physical copy before eligibility and availability checks.
- Payment idempotency keys prevent duplicate external transaction recording.
- Plan terms are snapshotted into each subscription.
