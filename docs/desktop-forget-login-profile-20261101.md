# Desktop: explicitly forget one remembered login profile

Follow-up to #3384. Desktop already supports up to 50 saved Server+Owner profiles and per-profile “clear saved password”, but has no way to remove one entire profile. This adds a distinct **忘记此账号资料** action only to the unauthenticated Desktop login form.

- A confirmation explains that the exact (server, username) history record is removed, including the safeStorage-encrypted stored password, auto-login flag, mount-path hint and LAN routing hint. Other saved profiles are untouched.
- The Electron Main handler validates the input, refuses an actively configured Agent Owner, aborts superseded in-flight login intents, and persists the changed history **before** returning success. An unconfirmed disk write is a visible failure; the previous history snapshot remains available. The renderer fences async login-history bootstrap and clears its own non-secret draft and in-memory password only after confirmed success.
- This is a local login-record deletion, **not** Server account deletion or logout, and it must not touch sync folders, backup Tasks, Server TLS CA trust or other Owner credentials. It does not pretend to erase any OS-level/browser password manager suggestions.
- Scope: Desktop Main/preload/types/login form/history, focused Node unit and source-contract tests only. No Android/iOS/Web/DSM changes, Agent protocol, or CI workflow edits.

Required: `desktop/tests/login-history.cjs` and `desktop/tests/desktop-forget-login-profile-contract.cjs`, desktop build/test shards, full PR CI and Final Gate on exact HEAD. Real Desktop UI/OS secret-store acceptance remains unverified (not a mandatory merge gate).
