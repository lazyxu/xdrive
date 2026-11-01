# xd CLI login hints (non-secret, MVP)

CLI users who mistype a password or encounter a transient network error should
not need to retype the HTTPS origin and username on the next attempt. The
existing authenticated configuration and OS secretstore remain independent.

- On a syntactically valid xd login attempt, the CLI saves only a versioned
  HTTPS server origin (which can itself be a certificate-validated LAN IP) and
  username. The atomic private 0600 JSON file is under userconfig.Dir(),
  alongside but separate from config.json. No password, refresh token, access
  token or Owner grant is ever stored in this draft.
- The next xd login --password-stdin may omit both --server and --username.
  Supplying a different explicit --server requires an explicit --username;
  switching hosts must not silently reuse another Owner username.
- A corrupted, oversized, symlinked or invalid old draft is ignored.
  A persistence failure prints a warning but does not block a valid login.
- xd login --forget-draft clears only this non-secret hint. It does not log
  the user out, revoke tokens, erase the authenticated config, or stop backups.
- Passwords are still required from --password-stdin, explicit --password,
  or XD_PASSWORD; no CLI password vault or automatic login was added. HTTPS
  and credential-handling rules remain unchanged.

Validation: go test ./cmd/xd -run 'TestXDLoginDraft|TestXDLoginTarget' and
existing HTTPS CLI login tests, plus exact-head PR CI and Final Gate.
