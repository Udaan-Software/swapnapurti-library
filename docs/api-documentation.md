# REST API

Base URL: `/api/v1`. All groups except authentication require the administrator session cookie and state-changing calls require `x-csrf-token`.

Implemented groups: `auth`, `dashboard`, `members`, `membership-plans`, `subscriptions`, `study-rooms`, `shifts`, `seat-allocations`, `attendance`, `books`, `loans`, `reservations`, `fines`, `payments`, `expenses`, `notifications`, `settings`, and `audit-logs`.

Responses use `{ success, data, meta? }`; failures use `{ success: false, error: { code, message, details? } }`. List routes provide bounded results, and high-volume member/subscription/book/audit routes expose pagination.
