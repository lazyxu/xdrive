# Web/PWA remembered login usernames (P1, browser-only)

- Preserve the existing **typed** username draft, last successful username, and HTTPS HttpOnly browser Cookie model. The per-Origin list is an additional bounded (max 8) convenience for users with multiple accounts on one Server; it stores **only usernames**, on successful authentication, with deduplication and input validation.
- The login form's MUI Autocomplete suggests these saved usernames. Choosing a different username clears the current **in-memory** password so another Owner cannot inherit it. Failed attempts do not add unverified usernames to the saved list.
- “清除当前用户名的自动填写记录” removes a single suggestion and that user's draft/last-used hint, rather than clearing all profiles. This action does **not** revoke or change the authenticated session/HttpOnly Cookie and is intentionally *not* labeled “忘记此设备”. A full Owner-scoped sign-out still uses the existing logout path and durable offline tombstone.
- Never touch `xdrive.username` (authoritative Cookie Owner marker), Cookie mode, pending logout, Web session credentials, offline snapshots, LAN/domain entry, or a different Origin. Same-Origin browser storage already separates domain and IP. Browser storage denial yields explicit error rather than false success.
- No changes to iOS/Android native code, DSM Agent, Desktop login history, Server auth, backup, workflows or unrelated PRs.

Validation: `node --test desktop/tests/web-login-username-profiles.cjs`, full PR CI Web/desktop source tests, applicable Cookie Login Real Web UI HTTPS Gin, and exact-head Final Gate. Production and multi-browser UI acceptance remains unverified.
