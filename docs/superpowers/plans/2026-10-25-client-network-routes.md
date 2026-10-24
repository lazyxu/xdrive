# Client network routes implementation plan

> **For agentic workers:** Use systematic-debugging and test-driven-development. Android and Desktop are independent implementation domains; review the integrated branch before delivery.

**Goal:** Fix Android/Windows hosts resolution differences and provide Auto / LAN-only / Public-only selection in both native clients.

**Architecture / approved scope:** Keep the configured HTTPS origin unchanged. Before login, perform bounded anonymous HTTPS verification against the selected socket IP. Auto tries the configured LAN IP first, then public DNS/IP only on transport unavailability; certificate failures stop rather than downgrade. Pin the chosen IP for this session and retain ordinary TLS verification on every actual request. Reconnect/relogin selects again; no automatic replay of credential-bearing or mutating requests. Existing connections without route settings remain compatible.

**Tech stack:** Kotlin/OkHttp/Compose; Electron Node HTTPS/DNS + React/MUI; existing Go Agent HTTP client.

## Global constraints

- Modes: `auto`, `lan`, `public`. Optional `lan_ip` and `public_ip` are literal IPs only. LAN-only requires a LAN IP; Public-only never uses private DNS results. No hardcoded installation IPs.
- Desktop public DNS uses Node DNS resolution (not OS hosts); an explicit public IP avoids DNS. Android uses its own device DNS, not Windows hosts.
- Store only per-origin route preferences and the selected session IP, never credentials in these fields. Origin changes cannot inherit another origin's route.
- Preserve Host, SNI, hostname/chain checks, redirect protections, private-IP CA approval/revocation and public updater isolation. No trust-all, root changes, router edits or production credentials.
- Temp/build/cache/profiles under `D:\code\xdrive\tmp\android-host-resolution-20261025`, with explicit TEMP/TMP/TMPDIR.
- One scoped source commit; GitHub PR with exact-head full CI/Final Gate, rebase merge first, then normal GitLab master fast-forward.

## Review focus

1. A TLS failure on the preferred route never leaks credentials or silently downgrades trust.
2. A hosts entry cannot trap Public-only on a LAN address.
3. Changing origin/account, logout, cancellation and late probes cannot reuse stale selection.
4. Desktop API, Go background client and signed preview use the same selected connection IP.
5. Existing private-IP approved CA flows, HTTP opt-in and anonymous updates stay unaffected.

## Task 1 — Android (independent)

- [ ] Add failing real TLS route tests, controller persistence/state tests and Compose controls tests; observe RED.
- [ ] Implement validated route preferences, anonymous selection and session IP pinning in `android/core`; typed safe errors.
- [ ] Wire Compose mode/IP inputs and connection preferences without tokens. Bump APK to code 4 / 0.1.3, fixed existing signature.
- [ ] Run all JVM tests, lint and instrumented UI tests; record fixture vs live evidence separately.

## Task 2 — Desktop and Agent

- [ ] Add failing Go real TLS tests for `Client.ConfigureConnectionIP(ip string) error`, plus config/IPC propagation tests.
- [ ] Configure per-origin direct socket IP in the existing Go HTTP transport, retaining all TLS and redirect policies; persist selected IP in userconfig; accept it through authenticated Desktop login IPC, expose nonsecret selected IP in status.
- [ ] Add failing Node TLS/DNS selection and login/profile/UI tests, then implement a bounded anonymous selector with `ConnectionRoute { mode: 'auto'|'lan'|'public'; lan_ip: string; public_ip: string }`.
- [ ] Wire manual/automatic login, per-origin saved preferences and pre-login probe. Resolve public DNS outside hosts. Pin selected IP for the actual Agent and exact-origin signed previews.
- [ ] Run targeted Go/Node tests, complete Desktop suite and typecheck/build. Preserve existing private-LAN trust tests.

## Task 3 — Integrated verification and delivery

- [ ] Fresh independent whole-branch security/correctness review; fix important findings with regression tests.
- [ ] Build fixed-key APK and verify signature/cover install without wiping user data; anonymous live checks only. Current LAN port 8443 refusal is an external availability issue, not a proven certificate or credential fault.
- [ ] Commit scoped paths, create/attach GitHub PR, verify full accurate-head CI/Final Gate, merge, then verify GitLab master synchronization.

## Diagnostic baseline

On 2026-10-25 Windows hosts resolves xd.1zkl.com to 192.168.2.4; ordinary DNS and actual MuMu resolve 122.235.226.93. MuMu public connection timed out; both Windows and MuMu forced LAN connection were refused before TLS. Desktop history contains the same HTTPS origin. These observations do not prove real account login success or a bad certificate.
