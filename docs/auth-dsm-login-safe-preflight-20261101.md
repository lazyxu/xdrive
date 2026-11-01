# DSM Server login: safe preflight before submitting the password

The original DSM login form clears the password and reloads the entire shared
workspace on both success and uncertain failure of an Agent POST. A lost ACK
can conceal a committed Owner change; retaining a password through that reload
or reusing old private UI would cross the Owner boundary.

This patch reduces avoidable re-entry without weakening that rule:

- Validate the HTTPS root URL, bounded username and bounded password locally,
  before contacting Agent. Invalid input remains editable in memory.
- Before every login POST, read the authenticated same-origin Agent
  serverConnection status. If unavailable, do not send password or reload;
  typed values remain in memory.
- If the Agent is configured, require the same HTTPS origin and username.
  Stop an unintended Server/Owner switch locally before sending a password,
  while the Go Agent retains its independent authoritative identity check.
- Closing Settings during preflight cancels the read before sending a POST.
  Once POST starts, an ambiguous Owner change requires full reload on both
  success and failure, even if the dialog was closed.
- Keep non-secret DSM Server/username draft and browser password-manager
  autofill. Never persist passwords, session tokens or Owner proofs in browser
  storage. No Server/Agent endpoint, CSRF/TLS rules or backup grant changes.

Validation: web/scripts/test-synology-gui-login.mjs, existing
desktop/tests/auth-login-draft-parity.cjs, Web TypeScript/build,
DSM specialty workflow, exact-HEAD complete CI and Final Gate.
Physical DSM/browser acceptance skipped (unverified).
