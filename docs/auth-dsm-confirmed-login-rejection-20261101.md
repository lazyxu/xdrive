# DSM known pre-commit credential failure

DSM has no independent password store. The user's password remains transient in the current React form.

- The owning Go Agent's authentication returns remote HTTP 401 before any `userconfig.Save` and exposes that specific status to its trusted loopback IPC client. Generic transport/403/409/5xx do not qualify.
- An authenticated same-origin DSM CGI with CSRF proof returns HTTP 422 and `X-XDrive-Login-No-Commit: 1` only for this typed no-commit rejection.
- The UI reads the owning Agent's ServerConnection again and retains the transient password only if Owner scope, Server and username are unchanged. A concurrent change forces a full workspace reload.
- Success, unknown/ambiguous failures and failed owner recheck clear the password and reload. No secret is stored in browser local/session storage, NAS config or logs.
- Required: exact-head DSM specialty + web TypeScript + Go + full CI/Final Gate, with real DSM device acceptance still unverified.
