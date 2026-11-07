# DSM local Backup authentication fault diagnosis

Applies to the DSM ARMv7 SPK with authenticated, same-origin HTTPS
`/webman/3rdparty/xdrivenas/backup.cgi?op=bootstrap`.
No secondary login or browser-provided username can bypass DSM authentication.
This is a diagnostic classification change, not evidence of live NAS acceptance.

## Why a 401 was misleading

Before this change, any `authenticate.cgi` execution failure, 3-second timeout
or malformed stdout became HTTP 401 and the shared Backup, Source setup and
share-inventory views all said "DSM session expired." However Synology's
documented CGI contract returns **no username** when not authenticated.
A helper that cannot run does not prove a logout.

The Go gateway now distinguishes empty successful stdout (401), execution
failure/timeout/missing CGI environment/bad output (503), unapproved installed
DSM principal (403) and invalid Origin/CSRF (403). Each response carries only
a fixed, status-matched `X-XDrive-DSM-Failure` value. No raw error, username,
Cookie, IP, path or token is returned or persisted. A failed DSM check never
contacts `xdrive-agent` and never authorizes a Source/Root mutation.

## Browser diagnosis (read-only)

1. Sign in to the DSM HTTPS origin used by the package (same host **and** port).
2. Open xDrive from the DSM launcher and press F12 -> Network.
3. Refresh Device Backup and inspect the HTTP status and
   `X-XDrive-DSM-Failure` of `backup.cgi?op=bootstrap`,
   `op=sources`, `op=server-connection` or `op=nas-shares`.
   Share only the numeric status and fixed failure code; **never share Cookie,
   SynoToken, response body, credentials, headers unrelated to the code or
   internal NAS paths**.

- `401 dsm-session-rejected`: native helper completed with no logged-in user.
  Reauthenticate at the same DSM HTTPS origin.
- `503 dsm-auth-helper-failed`: Synology's native authenticator failed to
  execute successfully. Inspect DSM system/CGI service logs and executable
  health; do not change the Server password or NAS ACL.
- `503 dsm-auth-timeout`: native validator exceeded its bounded deadline;
  inspect DSM service health and NAS load.
- `503 dsm-auth-environment`: DSM CGI required environment was not present.
- `503 dsm-auth-response-invalid`: unsupported or malformed identity; no
  identity is accepted.
- `503 dsm-auth-unavailable`: unclassified verifier exception; never assume
  this is a logout.
- `403 dsm-principal-unapproved`: native DSM username is not in the
  package-owned explicit authorization file. Perform the documented one-time
  NAS administrator authorization, not a browser-side auto-grant.
- `403 dsm-authority-unavailable`: installed package's authority file is
  missing, corrupt or unsafe to read. Inspect package configuration permissions;
  the browser cannot automatically create authority.
- `403 dsm-csrf-rejected`: same-origin/CSRF proof invalid; refresh from the
  original DSM origin. No backup command is executed.
- `503 agent-unavailable`: DSM auth passed but the package Agent is not
  reachable; this is not NAS share ACL failure.

A status without a recognised reason may come from DSM's external gateway or a
stale deployment. The UI does not invent a more specific explanation.

## Verification

Run `go test ./internal/synologyui` and
`node web/scripts/test-synology-nas-shares.mjs` in the repo's pinned toolchain,
then the exact-HEAD DSM UI, ARMv7/SPK, full CI and Final Gate before merge.
Physical DSM application behavior remains **跳过（未验收）** until NAS evidence.
