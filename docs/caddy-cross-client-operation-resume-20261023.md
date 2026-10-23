# Caddy operation restoration and bounded local comparison in shared UI

Current Host `deployed` remains a HISTORICAL terminal. The existing recent
`local_runtime_state` enum travels unchanged over Go Client/Agent and the
shared Web/Mobile/Desktop MUI panel. Even `matching-local` is displayed as a
recent unsigned observation, NEVER an independently signed Applied receipt.

An admin's exact Caddy Request ID and target SHA (no credential or raw .env)
are stored only in per-tab sessionStorage keyed by stable Server+account.
On relaunch the UI re-reads the authenticated, no-store Host status, checks
both identities and epoch, and refuses to submit a second deployment. Storage
unavailable, stale or malformed entries remain neutral. The Go backend still
owns the 64-entry/7-day original terminal retention and all permissions.

**Limits:** An ACK lost before the UI receives the request ID cannot be
recovered from browser storage. Persistent SQL operations, PostgreSQL
configuration revision/audit history, manual historical CAS rollback, independent
signed Applied Collector and operator Rescue remain outstanding and are not
claimed by this PR. No PostgreSQL Caddy Desired write is introduced.

Production-only acceptance: 按用户决定跳过（未验收）.
